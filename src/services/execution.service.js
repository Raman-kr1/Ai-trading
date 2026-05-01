/**
 * Trade Execution Service
 * ========================
 * Places orders on Binance / Zerodha APIs, or simulates them in paper mode.
 * SECURITY: Only trade permissions — NO withdrawal capabilities.
 */

const axios = require('axios');
const config = require('../config');
const Trade = require('../models/trade.model');
const { createHmacSignature, generateTradeId, roundTo } = require('../utils/helpers');
const { getKeepAliveConfig } = require('../utils/performance');
const { emit: emitEvent } = require('../utils/eventBus');
const logger = require('../utils/logger');

// Pre-configured keep-alive agents for low-latency order placement
const keepAlive = getKeepAliveConfig();

/**
 * Execute a trade based on the validated AI decision.
 *
 * @param {Object} params
 * @param {string} params.symbol      - Trading pair
 * @param {string} params.exchange    - 'binance' | 'zerodha'
 * @param {Object} params.decision    - Validated AI decision
 * @param {Object} params.riskCheck   - Risk validation result
 * @param {number} params.quantity    - Calculated position size
 * @param {string} params.aiDecisionId - Reference to Decision document
 * @returns {Object} Trade record
 */
async function executeTrade({ symbol, exchange, decision, riskCheck, quantity, aiDecisionId }) {
  const tradeId = generateTradeId();
  const isPaper = config.app.tradingMode === 'paper';

  logger.info(`${isPaper ? '📝 PAPER' : '🔥 LIVE'} executing ${decision.decision} ${symbol}`, {
    tradeId, quantity, entryPrice: decision.entry_price, exchange,
  });

  let exchangeResponse = null;
  let exchangeOrderId = null;

  try {
    if (isPaper) {
      // Paper trading — simulate the order
      exchangeResponse = simulatePaperTrade(symbol, decision, quantity);
      exchangeOrderId = `PAPER-${tradeId}`;
    } else if (exchange === 'binance') {
      const result = await placeBinanceOrder(symbol, decision, quantity);
      exchangeResponse = result;
      exchangeOrderId = result.orderId;
      // Best-effort: also lodge an OCO so the exchange itself enforces
      // SL/TP if our process dies. Failure here is logged but does not
      // void the entry trade — the in-process position monitor is the
      // primary exit path.
      try {
        const oco = await placeBinanceOco(symbol, decision, quantity);
        exchangeResponse = { entry: result, oco };
      } catch (ocoErr) {
        logger.warn('Binance OCO placement failed (entry succeeded)', {
          symbol, error: ocoErr.message,
        });
      }
    } else if (exchange === 'zerodha') {
      const result = await placeZerodhaOrder(symbol, decision, quantity);
      exchangeResponse = result;
      exchangeOrderId = result.order_id;
    }

    // Create trade record in database
    const trade = await Trade.create({
      tradeId,
      symbol,
      exchange: isPaper ? 'paper' : exchange,
      side: decision.decision,
      type: 'MARKET',
      quantity,
      entryPrice: decision.entry_price,
      stopLoss: decision.stop_loss,
      targetPrice: decision.target_price,
      status: 'OPEN',
      aiDecisionId,
      riskCheck: {
        passed: riskCheck.approved,
        riskRewardRatio: riskCheck.riskMetrics.riskRewardRatio,
        confidence: decision.confidence,
        dailyLossCheck: !riskCheck.reasons.some((r) => r.includes('Daily loss')),
        positionSizeCheck: !riskCheck.reasons.some((r) => r.includes('Position size')),
        reasons: riskCheck.reasons,
      },
      exchangeOrderId,
      exchangeResponse,
      tradingMode: isPaper ? 'paper' : 'live',
    });

    logger.info(`✅ Trade created: ${tradeId}`, { trade: trade.toJSON() });
    return trade;
  } catch (error) {
    logger.error(`❌ Trade execution failed: ${tradeId}`, { error: error.message, symbol });

    // Still log the failed attempt
    await Trade.create({
      tradeId, symbol, exchange: isPaper ? 'paper' : exchange,
      side: decision.decision, type: 'MARKET', quantity,
      entryPrice: decision.entry_price, stopLoss: decision.stop_loss,
      targetPrice: decision.target_price, status: 'REJECTED',
      notes: `Execution error: ${error.message}`,
      tradingMode: isPaper ? 'paper' : 'live',
    });

    throw error;
  }
}

// ─── Binance Order Placement ───────────────────────────────────

async function placeBinanceOrder(symbol, decision, quantity) {
  const timestamp = Date.now();
  const params = {
    symbol, side: decision.decision, type: 'MARKET',
    quantity: quantity.toString(), timestamp,
  };

  const queryString = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&');
  const signature = createHmacSignature(queryString, config.binance.apiSecret);

  const response = await axios.post(
    `${config.binance.baseUrl}/api/v3/order`,
    null,
    {
      params: { ...params, signature },
      headers: { 'X-MBX-APIKEY': config.binance.apiKey },
      timeout: 10000,
    }
  );

  logger.info('Binance order placed:', { orderId: response.data.orderId, status: response.data.status });
  return response.data;
}

/**
 * Place a Binance OCO (One-Cancels-Other) order pairing the
 * stop-loss and take-profit legs on the exchange itself. Used as a
 * safety net so exits trigger even if our server dies.
 *
 * Direction is the *opposite* of the entry side: a BUY entry needs a
 * SELL OCO to close, and vice-versa.
 */
async function placeBinanceOco(symbol, decision, quantity) {
  const closingSide = decision.decision === 'BUY' ? 'SELL' : 'BUY';
  const timestamp = Date.now();

  const stopPrice = roundTo(decision.stop_loss, 2);
  // Limit leg of the stop must be a hair worse than the trigger so it
  // actually fills in fast-moving markets.
  const stopLimitPrice = closingSide === 'SELL'
    ? roundTo(stopPrice * 0.999, 2)
    : roundTo(stopPrice * 1.001, 2);

  const params = {
    symbol,
    side: closingSide,
    quantity: quantity.toString(),
    price: roundTo(decision.target_price, 2).toString(),  // take-profit limit
    stopPrice: stopPrice.toString(),                       // stop trigger
    stopLimitPrice: stopLimitPrice.toString(),
    stopLimitTimeInForce: 'GTC',
    timestamp,
  };

  const queryString = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&');
  const signature = createHmacSignature(queryString, config.binance.apiSecret);

  const response = await axios.post(
    `${config.binance.baseUrl}/api/v3/order/oco`,
    null,
    {
      params: { ...params, signature },
      headers: { 'X-MBX-APIKEY': config.binance.apiKey },
      timeout: 10000,
    }
  );

  logger.info('Binance OCO placed', {
    symbol, listOrderId: response.data.orderListId,
    stop: stopPrice, target: params.price,
  });
  return response.data;
}

// ─── Zerodha Order Placement ───────────────────────────────────

async function placeZerodhaOrder(symbol, decision, quantity) {
  const orderData = {
    tradingsymbol: symbol,
    exchange: 'NSE',
    transaction_type: decision.decision,
    order_type: 'MARKET',
    quantity,
    product: 'MIS', // Intraday
    validity: 'DAY',
  };

  const response = await axios.post(
    `${config.zerodha.baseUrl}/orders/regular`,
    new URLSearchParams(orderData).toString(),
    {
      headers: {
        'X-Kite-Version': '3',
        Authorization: `token ${config.zerodha.apiKey}:${config.zerodha.accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 10000,
    }
  );

  logger.info('Zerodha order placed:', { orderId: response.data.data.order_id });
  return response.data.data;
}

// ─── Paper Trading Simulator ───────────────────────────────────

function simulatePaperTrade(symbol, decision, quantity) {
  const slippage = decision.entry_price * 0.001; // 0.1% simulated slippage
  const executedPrice = decision.decision === 'BUY'
    ? decision.entry_price + slippage
    : decision.entry_price - slippage;

  return {
    orderId: `SIM-${Date.now()}`, symbol,
    side: decision.decision, quantity,
    executedPrice: roundTo(executedPrice, 4),
    status: 'FILLED', simulatedFees: roundTo(executedPrice * quantity * 0.001, 4),
    timestamp: Date.now(),
  };
}

/**
 * Close a trade (update with exit price and PnL).
 */
async function closeTrade(tradeId, exitPrice) {
  try {
    const trade = await Trade.findOne({ tradeId });
    if (!trade) throw new Error(`Trade not found: ${tradeId}`);

    const pnl = trade.side === 'BUY'
      ? (exitPrice - trade.entryPrice) * trade.quantity
      : (trade.entryPrice - exitPrice) * trade.quantity;

    trade.exitPrice = exitPrice;
    trade.pnl = roundTo(pnl, 4);
    trade.pnlPercent = roundTo((pnl / (trade.entryPrice * trade.quantity)) * 100, 2);
    trade.status = 'CLOSED';
    trade.closedAt = new Date();

    await trade.save();
    logger.info(`Trade closed: ${tradeId}`, { pnl: trade.pnl, pnlPercent: trade.pnlPercent });
    emitEvent('trade:closed', trade.toObject ? trade.toObject() : trade);
    return trade;
  } catch (error) {
    logger.error(`Failed to close trade: ${tradeId}`, { error: error.message });
    throw error;
  }
}

module.exports = {
  executeTrade,
  closeTrade,
  placeBinanceOrder,
  placeBinanceOco,
  placeZerodhaOrder,
  simulatePaperTrade,
};
