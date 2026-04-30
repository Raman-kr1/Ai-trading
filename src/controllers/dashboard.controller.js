/**
 * Dashboard Controller
 * =====================
 * Serves the web dashboard and analytics API endpoints.
 */

const path = require('path');
const analyticsService = require('../services/analytics.service');
const logger = require('../utils/logger');

/** Serve the dashboard HTML page. */
function serveDashboard(req, res) {
  res.sendFile(path.join(__dirname, '../dashboard/index.html'));
}

/** Get portfolio stats. */
async function getStats(req, res) {
  try {
    const days = parseInt(req.query.days) || 30;
    const stats = await analyticsService.getPortfolioStats(days);
    res.json(stats);
  } catch (error) {
    logger.error('Dashboard stats error:', { error: error.message });
    res.status(500).json({ error: error.message });
  }
}

/** Get daily PnL breakdown. */
async function getDailyPnL(req, res) {
  try {
    const days = parseInt(req.query.days) || 7;
    const breakdown = await analyticsService.getDailyPnLBreakdown(days);
    res.json(breakdown);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

/** Get recent trades. */
async function getRecentTrades(req, res) {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const trades = await analyticsService.getRecentTrades(limit);
    res.json(trades);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

/** Get recent AI decisions. */
async function getRecentDecisions(req, res) {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const decisions = await analyticsService.getRecentDecisions(limit);
    res.json(decisions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

/** Get AI accuracy metrics. */
async function getAIAccuracy(req, res) {
  try {
    const accuracy = await analyticsService.getAIAccuracy();
    res.json(accuracy);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = { serveDashboard, getStats, getDailyPnL, getRecentTrades, getRecentDecisions, getAIAccuracy };
