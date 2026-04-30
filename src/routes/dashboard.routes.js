/**
 * Dashboard API Routes
 * =====================
 */

const express = require('express');
const router = express.Router();
const dc = require('../controllers/dashboard.controller');

router.get('/', dc.serveDashboard);
router.get('/api/stats', dc.getStats);
router.get('/api/daily-pnl', dc.getDailyPnL);
router.get('/api/trades', dc.getRecentTrades);
router.get('/api/decisions', dc.getRecentDecisions);
router.get('/api/ai-accuracy', dc.getAIAccuracy);

module.exports = router;
