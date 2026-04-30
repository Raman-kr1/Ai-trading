/**
 * Analytics Service
 * ==================
 * Tracks PnL, win rate, and aggregate trading statistics.
 */

const Trade = require('../models/trade.model');
const Decision = require('../models/decision.model');
const { roundTo } = require('../utils/helpers');
const logger = require('../utils/logger');

/** Get overall portfolio analytics. */
async function getPortfolioStats(days = 30) {
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const trades = await Trade.find({ createdAt: { $gte: since }, status: 'CLOSED' }).sort({ createdAt: -1 });

    const totalTrades = trades.length;
    const wins = trades.filter((t) => t.pnl > 0).length;
    const losses = trades.filter((t) => t.pnl < 0).length;
    const totalPnL = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const avgPnL = totalTrades > 0 ? totalPnL / totalTrades : 0;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

    const avgWin = wins > 0 ? trades.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0) / wins : 0;
    const avgLoss = losses > 0 ? trades.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0) / losses : 0;
    const profitFactor = avgLoss !== 0 ? Math.abs(avgWin * wins) / Math.abs(avgLoss * losses) : 0;

    return {
      period: `${days} days`, totalTrades, wins, losses,
      winRate: roundTo(winRate, 2), totalPnL: roundTo(totalPnL, 2),
      avgPnL: roundTo(avgPnL, 2), avgWin: roundTo(avgWin, 2),
      avgLoss: roundTo(avgLoss, 2), profitFactor: roundTo(profitFactor, 2),
    };
  } catch (error) {
    logger.error('Portfolio stats failed:', { error: error.message });
    throw error;
  }
}

/** Get daily PnL breakdown. */
async function getDailyPnLBreakdown(days = 7) {
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const trades = await Trade.find({ status: 'CLOSED', closedAt: { $gte: since } });

    const daily = {};
    for (const trade of trades) {
      const day = trade.closedAt.toISOString().split('T')[0];
      if (!daily[day]) daily[day] = { pnl: 0, trades: 0, wins: 0 };
      daily[day].pnl += trade.pnl || 0;
      daily[day].trades++;
      if (trade.pnl > 0) daily[day].wins++;
    }

    return Object.entries(daily).map(([date, data]) => ({
      date, pnl: roundTo(data.pnl, 2), trades: data.trades,
      winRate: roundTo((data.wins / data.trades) * 100, 2),
    })).sort((a, b) => a.date.localeCompare(b.date));
  } catch (error) {
    logger.error('Daily PnL breakdown failed:', { error: error.message });
    throw error;
  }
}

/** Get recent trades. */
async function getRecentTrades(limit = 20) {
  return Trade.find().sort({ createdAt: -1 }).limit(limit).lean();
}

/** Get recent AI decisions. */
async function getRecentDecisions(limit = 20) {
  return Decision.find().sort({ createdAt: -1 }).limit(limit).lean();
}

/** Get AI decision accuracy stats. */
async function getAIAccuracy() {
  try {
    const decisions = await Decision.find({ executed: true }).lean();
    const total = decisions.length;
    if (total === 0) return { total: 0, accuracy: 0 };

    // Match decisions to closed trades to determine accuracy
    let correct = 0;
    for (const d of decisions) {
      if (d.tradeId) {
        const trade = await Trade.findOne({ tradeId: d.tradeId, status: 'CLOSED' }).lean();
        if (trade && trade.pnl > 0) correct++;
      }
    }

    return { total, correct, accuracy: roundTo((correct / total) * 100, 2) };
  } catch (error) {
    logger.error('AI accuracy calc failed:', { error: error.message });
    return { total: 0, correct: 0, accuracy: 0 };
  }
}

module.exports = { getPortfolioStats, getDailyPnLBreakdown, getRecentTrades, getRecentDecisions, getAIAccuracy };
