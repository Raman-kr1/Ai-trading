/**
 * Risk Engine (Hard Rules)
 * =========================
 * Enforces non-negotiable risk management rules that OVERRIDE AI decisions.
 * No trade is executed unless it passes ALL risk checks.
 *
 * Rules:
 *   1. Risk/Reward ratio must be ≥ 1:2
 *   2. AI confidence must be ≥ 60%
 *   3. Daily loss must not exceed 2% of capital
 *   4. Trade size must not exceed 5% of capital
 *   5. Max open positions limit
 */

const config = require('../config');
const Trade = require('../models/trade.model');
const logger = require('../utils/logger');
const { roundTo } = require('../utils/helpers');

/**
 * Validate a trade decision against all risk rules.
 *
 * @param {Object} decision   - AI decision { decision, entry_price, stop_loss, target_price, confidence }
 * @param {number} capital    - Current total capital (portfolio value)
 * @param {string} symbol     - Trading pair/instrument
 * @returns {Object} { approved, reasons[], riskMetrics }
 */
async function validateTrade(decision, capital, symbol) {
  const reasons = [];
  const metrics = {};

  // ── Rule 1: Risk/Reward Ratio ─────────────────────────────
  const risk = Math.abs(decision.entry_price - decision.stop_loss);
  const reward = Math.abs(decision.target_price - decision.entry_price);
  const riskRewardRatio = risk > 0 ? roundTo(reward / risk, 2) : 0;
  metrics.riskRewardRatio = riskRewardRatio;

  if (riskRewardRatio < config.risk.minRiskRewardRatio) {
    reasons.push(
      `Risk/Reward ratio ${riskRewardRatio}:1 is below minimum ${config.risk.minRiskRewardRatio}:1`
    );
  }

  // ── Rule 2: Confidence Threshold ──────────────────────────
  metrics.confidence = decision.confidence;
  if (decision.confidence < config.risk.minConfidenceScore) {
    reasons.push(
      `Confidence ${decision.confidence}% is below minimum ${config.risk.minConfidenceScore}%`
    );
  }

  // ── Rule 3: Daily Loss Limit ──────────────────────────────
  const dailyPnL = await getDailyPnL();
  const dailyLossPercent = capital > 0 ? roundTo((Math.abs(dailyPnL) / capital) * 100, 2) : 0;
  metrics.dailyLossPercent = dailyLossPercent;
  metrics.dailyPnL = dailyPnL;

  if (dailyPnL < 0 && dailyLossPercent >= config.risk.maxDailyLossPercent) {
    reasons.push(
      `Daily loss ${dailyLossPercent}% exceeds maximum ${config.risk.maxDailyLossPercent}%`
    );
  }

  // ── Rule 4: Position Size Limit ───────────────────────────
  const positionValue = decision.entry_price * (decision.quantity || 1);
  const positionPercent = capital > 0 ? roundTo((positionValue / capital) * 100, 2) : 100;
  metrics.positionPercent = positionPercent;

  if (positionPercent > config.risk.maxTradeSizePercent) {
    reasons.push(
      `Position size ${positionPercent}% exceeds maximum ${config.risk.maxTradeSizePercent}%`
    );
  }

  // ── Rule 5: Max Open Positions ────────────────────────────
  const openPositions = await getOpenPositionCount();
  metrics.openPositions = openPositions;

  if (openPositions >= config.risk.maxOpenPositions) {
    reasons.push(
      `Open positions (${openPositions}) at maximum limit (${config.risk.maxOpenPositions})`
    );
  }

  // ── Rule 6: HOLD decisions are auto-rejected ──────────────
  if (decision.decision === 'HOLD') {
    reasons.push('AI decision is HOLD — no trade to execute');
  }

  // ── Rule 7: Invalid price levels ──────────────────────────
  if (decision.entry_price <= 0 || decision.stop_loss <= 0 || decision.target_price <= 0) {
    reasons.push('Invalid price levels (zero or negative)');
  }

  // For BUY: stop_loss should be below entry, target above entry
  if (decision.decision === 'BUY') {
    if (decision.stop_loss >= decision.entry_price) {
      reasons.push('BUY: stop_loss must be below entry_price');
    }
    if (decision.target_price <= decision.entry_price) {
      reasons.push('BUY: target_price must be above entry_price');
    }
  }

  // For SELL: stop_loss should be above entry, target below entry
  if (decision.decision === 'SELL') {
    if (decision.stop_loss <= decision.entry_price) {
      reasons.push('SELL: stop_loss must be above entry_price');
    }
    if (decision.target_price >= decision.entry_price) {
      reasons.push('SELL: target_price must be below entry_price');
    }
  }

  const approved = reasons.length === 0;

  const result = { approved, reasons, riskMetrics: metrics };

  logger.info(`Risk validation for ${symbol}: ${approved ? '✅ APPROVED' : '❌ REJECTED'}`, {
    symbol, approved, reasons, metrics,
  });

  return result;
}

/**
 * Calculate optimal position size based on risk parameters.
 * Uses fixed fractional position sizing.
 */
function calculatePositionSize(capital, entryPrice, stopLoss) {
  const maxRiskAmount = capital * (config.risk.maxTradeSizePercent / 100);
  const riskPerUnit = Math.abs(entryPrice - stopLoss);

  if (riskPerUnit === 0) return 0;

  const quantity = Math.floor(maxRiskAmount / riskPerUnit);
  const positionValue = quantity * entryPrice;

  // Ensure position doesn't exceed max allowed
  if (positionValue > capital * (config.risk.maxTradeSizePercent / 100)) {
    return Math.floor((capital * (config.risk.maxTradeSizePercent / 100)) / entryPrice);
  }

  return quantity;
}

/**
 * Get today's realized PnL from closed trades.
 */
async function getDailyPnL() {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const trades = await Trade.find({
      status: 'CLOSED',
      closedAt: { $gte: todayStart },
    });

    return trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  } catch (error) {
    logger.error('Failed to calculate daily PnL:', { error: error.message });
    return 0;
  }
}

/**
 * Get count of currently open positions.
 */
async function getOpenPositionCount() {
  try {
    return await Trade.countDocuments({ status: { $in: ['OPEN', 'PENDING'] } });
  } catch (error) {
    logger.error('Failed to count open positions:', { error: error.message });
    return 0;
  }
}

module.exports = { validateTrade, calculatePositionSize, getDailyPnL, getOpenPositionCount };
