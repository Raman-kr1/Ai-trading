/**
 * Trading API Routes
 * ===================
 * RESTful endpoints for the trading system.
 */

const express = require('express');
const router = express.Router();
const tc = require('../controllers/trading.controller');

// ── Market Data ────────────────────────────────────────────────
router.get('/market-data', tc.getMarketData);
router.get('/indicators', tc.getIndicators);

// ── Trading ────────────────────────────────────────────────────
router.post('/trade', tc.triggerTrade);
router.post('/trade/close', tc.closeTrade);
router.post('/ai-analysis', tc.getAIAnalysis);

// ── Watchlist & Queue ──────────────────────────────────────────
router.post('/watchlist', tc.updateWatchlist);
router.get('/queue/status', tc.getQueueStatus);

module.exports = router;
