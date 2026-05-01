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
