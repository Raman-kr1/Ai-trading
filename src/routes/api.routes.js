/**
 * Frontend API Routes
 * --------------------
 * The dashboard talks to these endpoints. Keep this file flat and
 * predictable — no nested resource trees.
 */

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/api.controller');
const { addTradingJob } = require('../workers/tradingWorker');
const positionMonitor = require('../services/positionMonitor.service');
const killSwitch = require('../services/killSwitch.service');
const scannerService = require('../services/scanner.service');
const askAi = require('../services/askAi.service');
const watchlist = require('../config/watchlist');

router.get('/market-data', ctrl.getMarketData);
router.get('/ai-decision', ctrl.getAIDecision);
router.get('/trades', ctrl.getTrades);
router.post('/trades/:tradeId/close', ctrl.postCloseTrade);
router.get('/status', ctrl.getStatus);
router.get('/logs', ctrl.getLogs);
router.get('/pnl-series', ctrl.getPnlSeries);

router.get('/positions', (_req, res) => {
  res.json(positionMonitor.snapshot());
});

// ── Kill switch ──────────────────────────────────────────────
router.get('/kill-switch', async (_req, res) => {
  try {
    res.json(await killSwitch.getStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/kill-switch/halt', async (req, res) => {
  try {
    const reason = (req.body && req.body.reason) || 'manual via dashboard';
    res.json(await killSwitch.halt(reason));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/kill-switch/resume', async (req, res) => {
  try {
    const actor = (req.body && req.body.actor) || 'dashboard';
    res.json(await killSwitch.resume(actor));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Watchlist + scanner + ask-ai ─────────────────────────────
router.get('/watchlist', (_req, res) => {
  const assets = watchlist.getActive().map((a) => ({
    id: a.id, symbol: a.symbol, exchange: a.exchange,
    assetClass: a.assetClass, timeframe: a.timeframe,
    marketOpen: watchlist.isMarketOpen(a),
  }));
  res.json({ assets });
});

router.get('/scan', async (req, res) => {
  try {
    const topN = Math.max(1, Math.min(10, parseInt(req.query.topN, 10) || 3));
    res.json(await scannerService.runCycle({ topN }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/ask-ai', async (req, res) => {
  try {
    const { symbol, question } = req.body || {};
    res.json(await askAi.answerQuestion({ symbol, question }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manual "Execute Trade" action from the trade panel.
router.post('/execute', async (req, res) => {
  try {
    const { symbol = 'BTCUSDT', exchange = 'binance', timeframe = '1m', capital = 10000 } = req.body || {};
    const job = await addTradingJob(symbol.toUpperCase(), exchange, { timeframe, capital });
    res.json({ jobId: job.id, symbol, exchange, queued: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
