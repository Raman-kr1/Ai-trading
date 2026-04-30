/**
 * Backtesting Module
 * ===================
 * Simulates the trading pipeline against historical data.
 * Evaluates AI decision quality and risk engine effectiveness.
 *
 * Usage: node src/backtesting/backtest.service.js
 */

const config = require('../config');
const { connectDatabase, disconnectDatabase } = require('../config/database');
const marketDataService = require('../services/marketData.service');
const indicatorService = require('../services/indicator.service');
const aiService = require('../services/ai.service');
const riskService = require('../services/risk.service');
const { roundTo } = require('../utils/helpers');
const logger = require('../utils/logger');

/**
 * Run a backtest on historical data.
 *
 * @param {Object} params
 * @param {string} params.symbol     - Trading pair
 * @param {string} params.exchange   - 'binance' | 'zerodha'
 * @param {string} params.timeframe  - Candle interval
 * @param {number} params.capital    - Starting capital
 * @param {number} params.lookback   - Number of candles to fetch
 */
async function runBacktest({ symbol = 'BTCUSDT', exchange = 'binance', timeframe = '1m', capital = 10000, lookback = 500 }) {
  logger.info(`📊 Starting backtest: ${symbol} [${exchange}] | Capital: $${capital}`);

  // Fetch historical data
  let allCandles;
  if (exchange === 'binance') {
    allCandles = await marketDataService.fetchBinanceKlines(symbol, timeframe, lookback);
  } else {
    allCandles = await marketDataService.fetchZerodhaCandles(symbol, timeframe);
  }

  if (!allCandles || allCandles.length < 50) {
    logger.error('Insufficient historical data for backtest');
    return null;
  }

  // Simulation state
  let currentCapital = capital;
  const trades = [];
  let wins = 0, losses = 0;
  const windowSize = 50; // Minimum candles needed for indicators

  logger.info(`Processing ${allCandles.length - windowSize} candles...`);

  // Slide through the data
  for (let i = windowSize; i < allCandles.length; i++) {
    const windowCandles = allCandles.slice(i - windowSize, i);
    const currentCandle = allCandles[i];

    // Compute indicators
    const indicators = indicatorService.computeAllIndicators(windowCandles);
    if (!indicators) continue;

    // Get AI decision (uses real Claude API or mock)
    let decision;
    try {
      decision = await aiService.getTradeDecision(symbol, indicators, windowCandles, exchange);
    } catch {
      continue;
    }

    if (decision.decision === 'HOLD') continue;

    // Calculate position size
    const quantity = riskService.calculatePositionSize(currentCapital, decision.entry_price, decision.stop_loss);
    if (quantity <= 0) continue;
    decision.quantity = quantity;

    // Risk check
    const riskCheck = await riskService.validateTrade(decision, currentCapital, symbol);
    if (!riskCheck.approved) continue;

    // Simulate trade outcome using actual future candle
    const entryPrice = currentCandle.close;
    let exitPrice;
    let outcome;

    // Check if stop loss or target is hit in subsequent candles
    let hitTarget = false, hitStop = false;
    for (let j = i + 1; j < Math.min(i + 20, allCandles.length); j++) {
      const futureCandle = allCandles[j];
      if (decision.decision === 'BUY') {
        if (futureCandle.low <= decision.stop_loss) { hitStop = true; exitPrice = decision.stop_loss; break; }
        if (futureCandle.high >= decision.target_price) { hitTarget = true; exitPrice = decision.target_price; break; }
      } else {
        if (futureCandle.high >= decision.stop_loss) { hitStop = true; exitPrice = decision.stop_loss; break; }
        if (futureCandle.low <= decision.target_price) { hitTarget = true; exitPrice = decision.target_price; break; }
      }
    }

    if (!hitTarget && !hitStop) continue; // Neither hit within lookforward window

    // Calculate PnL
    const pnl = decision.decision === 'BUY'
      ? (exitPrice - entryPrice) * quantity
      : (entryPrice - exitPrice) * quantity;

    currentCapital += pnl;
    outcome = pnl > 0 ? 'WIN' : 'LOSS';
    if (pnl > 0) wins++; else losses++;

    trades.push({
      timestamp: currentCandle.timestamp,
      side: decision.decision,
      entry: roundTo(entryPrice, 4),
      exit: roundTo(exitPrice, 4),
      quantity,
      pnl: roundTo(pnl, 2),
      confidence: decision.confidence,
      outcome,
      capitalAfter: roundTo(currentCapital, 2),
    });
  }

  // Generate report
  const totalTrades = trades.length;
  const totalPnL = currentCapital - capital;
  const winRate = totalTrades > 0 ? roundTo((wins / totalTrades) * 100, 2) : 0;
  const avgWin = wins > 0 ? roundTo(trades.filter(t => t.outcome === 'WIN').reduce((s, t) => s + t.pnl, 0) / wins, 2) : 0;
  const avgLoss = losses > 0 ? roundTo(trades.filter(t => t.outcome === 'LOSS').reduce((s, t) => s + t.pnl, 0) / losses, 2) : 0;
  const maxDrawdown = calculateMaxDrawdown(trades, capital);

  const report = {
    symbol, exchange, timeframe,
    startCapital: capital,
    endCapital: roundTo(currentCapital, 2),
    totalPnL: roundTo(totalPnL, 2),
    returnPercent: roundTo((totalPnL / capital) * 100, 2),
    totalTrades, wins, losses, winRate,
    avgWin, avgLoss,
    profitFactor: avgLoss !== 0 ? roundTo(Math.abs(avgWin * wins) / Math.abs(avgLoss * losses), 2) : 0,
    maxDrawdown: roundTo(maxDrawdown, 2),
    trades: trades.slice(-10), // Last 10 trades
  };

  logger.info(`
╔══════════════════════════════════════════════════╗
║              BACKTEST RESULTS                    ║
╠══════════════════════════════════════════════════╣
║  Symbol:        ${symbol.padEnd(33)}║
║  Total Trades:  ${String(totalTrades).padEnd(33)}║
║  Win Rate:      ${(winRate + '%').padEnd(33)}║
║  Total PnL:     $${roundTo(totalPnL, 2).toString().padEnd(31)}║
║  Return:        ${(roundTo((totalPnL / capital) * 100, 2) + '%').padEnd(33)}║
║  Max Drawdown:  ${(roundTo(maxDrawdown, 2) + '%').padEnd(33)}║
║  Profit Factor: ${report.profitFactor.toString().padEnd(33)}║
╚══════════════════════════════════════════════════╝
  `);

  return report;
}

function calculateMaxDrawdown(trades, startCapital) {
  let peak = startCapital;
  let maxDD = 0;
  let capital = startCapital;
  for (const t of trades) {
    capital += t.pnl;
    if (capital > peak) peak = capital;
    const dd = ((peak - capital) / peak) * 100;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

// ── CLI Execution ──────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    await connectDatabase();
    await runBacktest({
      symbol: process.argv[2] || 'BTCUSDT',
      exchange: process.argv[3] || 'binance',
      timeframe: process.argv[4] || '1m',
      capital: parseFloat(process.argv[5]) || 10000,
      lookback: parseInt(process.argv[6]) || 500,
    });
    await disconnectDatabase();
    process.exit(0);
  })();
}

module.exports = { runBacktest };
