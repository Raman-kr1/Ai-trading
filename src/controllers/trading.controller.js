/**
 * Trading Controller
 * ===================
 * Handles HTTP request/response for trading endpoints.
 */

const { addTradingJob, scheduleRecurringJobs, tradingQueue } = require('../workers/tradingWorker');
const marketDataService = require('../services/marketData.service');
const indicatorService = require('../services/indicator.service');
const aiService = require('../services/ai.service');
const riskService = require('../services/risk.service');
const executionService = require('../services/execution.service');
const analyticsService = require('../services/analytics.service');
const logger = require('../utils/logger');

/** Trigger a single trading cycle for a symbol. */
async function triggerTrade(req, res) {
  try {
    const { symbol, exchange = 'binance', timeframe = '1m', capital = 10000 } = req.body;
    if (!symbol) return res.status(400).json({ error: 'symbol is required' });

    const job = await addTradingJob(symbol, exchange, { timeframe, capital });
    res.json({ message: 'Trade job queued', jobId: job.id, symbol, exchange });
  } catch (error) {
    logger.error('Trigger trade error:', { error: error.message });
    res.status(500).json({ error: error.message });
  }
}

/** Get market data for a symbol. */
async function getMarketData(req, res) {
  try {
    const { symbol, exchange = 'binance', timeframe = '1m', limit = 100 } = req.query;
    if (!symbol) return res.status(400).json({ error: 'symbol is required' });

    let candles;
    if (exchange === 'binance') {
      candles = await marketDataService.fetchBinanceKlines(symbol, timeframe, parseInt(limit));
    } else {
      candles = await marketDataService.fetchZerodhaCandles(symbol, timeframe);
    }

    res.json({ symbol, exchange, timeframe, count: candles.length, candles });
  } catch (error) {
    logger.error('Market data error:', { error: error.message });
    res.status(500).json({ error: error.message });
  }
}

/** Get indicators for a symbol. */
async function getIndicators(req, res) {
  try {
    const { symbol, exchange = 'binance', timeframe = '1m' } = req.query;
    if (!symbol) return res.status(400).json({ error: 'symbol is required' });

    let candles;
    if (exchange === 'binance') {
      candles = await marketDataService.fetchBinanceKlines(symbol, timeframe, 100);
    } else {
      candles = await marketDataService.fetchZerodhaCandles(symbol, timeframe);
    }

    const indicators = indicatorService.computeAllIndicators(candles);
    if (!indicators) return res.status(400).json({ error: 'Insufficient data for indicators' });

    res.json({ symbol, exchange, timeframe, indicators });
  } catch (error) {
    logger.error('Indicators error:', { error: error.message });
    res.status(500).json({ error: error.message });
  }
}

/** Get AI analysis (without executing). */
async function getAIAnalysis(req, res) {
  try {
    const { symbol, exchange = 'binance', timeframe = '1m' } = req.body;
    if (!symbol) return res.status(400).json({ error: 'symbol is required' });

    let candles;
    if (exchange === 'binance') {
      candles = await marketDataService.fetchBinanceKlines(symbol, timeframe, 100);
    } else {
      candles = await marketDataService.fetchZerodhaCandles(symbol, timeframe);
    }

    const indicators = indicatorService.computeAllIndicators(candles);
    if (!indicators) return res.status(400).json({ error: 'Insufficient data' });

    const decision = await aiService.getTradeDecision(symbol, indicators, candles, exchange);
    res.json({ symbol, exchange, indicators, decision });
  } catch (error) {
    logger.error('AI analysis error:', { error: error.message });
    res.status(500).json({ error: error.message });
  }
}

/** Close a trade manually. */
async function closeTrade(req, res) {
  try {
    const { tradeId, exitPrice } = req.body;
    if (!tradeId || !exitPrice) return res.status(400).json({ error: 'tradeId and exitPrice required' });

    const trade = await executionService.closeTrade(tradeId, parseFloat(exitPrice));
    res.json({ message: 'Trade closed', trade });
  } catch (error) {
    logger.error('Close trade error:', { error: error.message });
    res.status(500).json({ error: error.message });
  }
}

/** Update watchlist and schedule recurring jobs. */
async function updateWatchlist(req, res) {
  try {
    const { symbols } = req.body;
    if (!symbols || !Array.isArray(symbols)) {
      return res.status(400).json({ error: 'symbols array is required' });
    }
    await scheduleRecurringJobs(symbols);
    res.json({ message: 'Watchlist updated', symbols });
  } catch (error) {
    logger.error('Watchlist update error:', { error: error.message });
    res.status(500).json({ error: error.message });
  }
}

/** Get queue status. */
async function getQueueStatus(req, res) {
  try {
    const [waiting, active, completed, failed] = await Promise.all([
      tradingQueue.getWaitingCount(),
      tradingQueue.getActiveCount(),
      tradingQueue.getCompletedCount(),
      tradingQueue.getFailedCount(),
    ]);
    res.json({ queue: 'trading-pipeline', waiting, active, completed, failed });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  triggerTrade, getMarketData, getIndicators,
  getAIAnalysis, closeTrade, updateWatchlist, getQueueStatus,
};
