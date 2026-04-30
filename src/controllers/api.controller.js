/**
 * Frontend-facing API Controller
 * ===============================
 * Implements the exact endpoint shape the React dashboard expects:
 *   GET /api/market-data
 *   GET /api/ai-decision
 *   GET /api/trades
 *   GET /api/status
 *   GET /api/logs
 *
 * These wrap the underlying trading services so the frontend doesn't
 * have to know about the BullMQ / multi-exchange surface area.
 */

const mongoose = require('mongoose');
const config = require('../config');
const marketDataService = require('../services/marketData.service');
const indicatorService = require('../services/indicator.service');
const aiService = require('../services/ai.service');
const executionService = require('../services/execution.service');
const { redisClient } = require('../config/redis');
const Trade = require('../models/trade.model');
const Decision = require('../models/decision.model');
const Log = require('../models/log.model');
const logger = require('../utils/logger');

const DEFAULT_SYMBOL = 'BTCUSDT';

// ── GET /api/market-data ───────────────────────────────────────
async function getMarketData(req, res) {
  try {
    const symbol = (req.query.symbol || DEFAULT_SYMBOL).toUpperCase();
    const timeframe = req.query.timeframe || '1m';
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

    const candles = await marketDataService.fetchBinanceKlines(symbol, timeframe, limit);
    const last = candles[candles.length - 1];
    const indicators = indicatorService.computeAllIndicators(candles);

    res.json({
      symbol,
      timeframe,
      price: last?.close ?? null,
      change: indicators?.priceChange ?? 0,
      changePercent: indicators?.priceChangePercent ?? 0,
      candles,
      indicators,
      timestamp: Date.now(),
    });
  } catch (err) {
    logger.error('GET /api/market-data failed:', { error: err.message });
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/ai-decision ───────────────────────────────────────
// Returns latest persisted decision; if `live=true`, runs a fresh
// inference against current candles instead.
async function getAIDecision(req, res) {
  try {
    const symbol = (req.query.symbol || DEFAULT_SYMBOL).toUpperCase();
    const live = req.query.live === 'true';

    if (!live) {
      const latest = await Decision.findOne({ symbol }).sort({ createdAt: -1 }).lean();
      if (latest) return res.json(latest);
    }

    const candles = await marketDataService.fetchBinanceKlines(symbol, '1m', 100);
    const indicators = indicatorService.computeAllIndicators(candles);
    if (!indicators) return res.status(400).json({ error: 'Insufficient data' });

    const decision = await aiService.getTradeDecision(symbol, indicators, candles, 'binance');

    res.json({
      symbol,
      exchange: 'binance',
      timeframe: '1m',
      decision: decision.decision,
      entryPrice: decision.entry_price,
      stopLoss: decision.stop_loss,
      targetPrice: decision.target_price,
      confidence: decision.confidence,
      reasoning: decision.reasoning,
      indicators,
      live: true,
      timestamp: Date.now(),
    });
  } catch (err) {
    logger.error('GET /api/ai-decision failed:', { error: err.message });
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/trades ────────────────────────────────────────────
async function getTrades(req, res) {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const search = req.query.search?.trim();
    const status = req.query.status?.toUpperCase();
    const side = req.query.side?.toUpperCase();

    const filter = {};
    if (status) filter.status = status;
    if (side) filter.side = side;
    if (search) filter.symbol = { $regex: search, $options: 'i' };

    const [items, total] = await Promise.all([
      Trade.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Trade.countDocuments(filter),
    ]);

    const stats = await Trade.aggregate([
      { $group: {
        _id: null,
        totalPnl: { $sum: '$pnl' },
        winners: { $sum: { $cond: [{ $gt: ['$pnl', 0] }, 1, 0] } },
        losers: { $sum: { $cond: [{ $lt: ['$pnl', 0] }, 1, 0] } },
        closed: { $sum: { $cond: [{ $eq: ['$status', 'CLOSED'] }, 1, 0] } },
      } },
    ]);

    res.json({
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      stats: stats[0] || { totalPnl: 0, winners: 0, losers: 0, closed: 0 },
      trades: items,
    });
  } catch (err) {
    logger.error('GET /api/trades failed:', { error: err.message });
    res.status(500).json({ error: err.message });
  }
}

// ── POST /api/trades/:tradeId/close ────────────────────────────
async function postCloseTrade(req, res) {
  try {
    const { tradeId } = req.params;
    const { exitPrice } = req.body;
    if (!exitPrice) return res.status(400).json({ error: 'exitPrice required' });
    const trade = await executionService.closeTrade(tradeId, parseFloat(exitPrice));
    res.json({ trade });
  } catch (err) {
    logger.error('POST /api/trades/:id/close failed:', { error: err.message });
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/status ────────────────────────────────────────────
async function getStatus(req, res) {
  const mongo = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';

  let redis = 'disconnected';
  try {
    if (redisClient && redisClient.status === 'ready') redis = 'connected';
    else if (redisClient) redis = redisClient.status;
  } catch { /* keep default */ }

  let binance = 'unknown';
  try {
    const price = await marketDataService.fetchBinancePrice(DEFAULT_SYMBOL);
    binance = price > 0 ? 'connected' : 'degraded';
  } catch (err) {
    binance = 'error';
  }

  const claude = config.claude.apiKey ? 'configured' : 'missing-key';

  res.json({
    services: {
      mongo,
      redis,
      binance,
      claude,
    },
    tradingMode: config.app.tradingMode,
    env: config.app.env,
    uptimeSeconds: Math.floor(process.uptime()),
    risk: config.risk,
    timestamp: Date.now(),
  });
}

// ── GET /api/logs ──────────────────────────────────────────────
async function getLogs(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    const level = req.query.level;
    const filter = {};
    if (level) filter.level = level;

    const logs = await Log.find(filter).sort({ timestamp: -1 }).limit(limit).lean();
    res.json({ count: logs.length, logs });
  } catch (err) {
    logger.error('GET /api/logs failed:', { error: err.message });
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/pnl-series ─ closed-trade equity curve for the dashboard chart
async function getPnlSeries(req, res) {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 30, 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const trades = await Trade.find({
      status: 'CLOSED',
      closedAt: { $gte: since },
    })
      .sort({ closedAt: 1 })
      .select('closedAt pnl pnlPercent symbol side')
      .lean();

    let cumulative = 0;
    const series = trades.map((t) => {
      cumulative += t.pnl || 0;
      return {
        t: t.closedAt,
        pnl: t.pnl,
        pnlPercent: t.pnlPercent,
        cumulative,
        symbol: t.symbol,
        side: t.side,
      };
    });

    res.json({ days, count: series.length, series });
  } catch (err) {
    logger.error('GET /api/pnl-series failed:', { error: err.message });
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getMarketData,
  getAIDecision,
  getTrades,
  postCloseTrade,
  getStatus,
  getLogs,
  getPnlSeries,
};
