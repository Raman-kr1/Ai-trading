/**
 * Kill Switch
 * ============
 * Global "stop all trading" flag. Two layers:
 *
 *   1. Static (env)   — TRADING_HALTED=true at boot. Cannot be cleared
 *      at runtime; intended for ops/maintenance windows.
 *   2. Runtime (Redis) — `system:trading:halted` key. Toggleable from
 *      the dashboard or any internal caller. Persists across restarts
 *      because Redis owns it.
 *
 * Either layer being set blocks the entire pipeline:
 *   - Worker: skips the job before any market-data fetch
 *   - Risk engine: rejects trades even if dashboard somehow bypasses
 *   - Execution service: hard refusal at the order placement step
 *
 * Defense in depth — three independent checks so a single bug can't
 * silently re-enable trading.
 */

'use strict';

const { redisClient } = require('../config/redis');
const config = require('../config');
const { emit: emitEvent } = require('../utils/eventBus');
const logger = require('../utils/logger');

const KEY = 'system:trading:halted';
const REASON_KEY = 'system:trading:halted:reason';

function envHalted() {
  return process.env.TRADING_HALTED === 'true' || process.env.TRADING_HALTED === '1';
}

async function isHalted() {
  if (envHalted()) return true;
  try {
    const v = await redisClient.get(KEY);
    return v === '1' || v === 'true';
  } catch (err) {
    // Fail-safe: if Redis is unreachable, assume halted. Better to
    // block trading than to keep firing orders blind.
    logger.warn('Kill-switch Redis read failed — defaulting to HALTED', { error: err.message });
    return true;
  }
}

async function getReason() {
  if (envHalted()) return 'env:TRADING_HALTED';
  try {
    return (await redisClient.get(REASON_KEY)) || null;
  } catch {
    return 'redis-unreachable';
  }
}

async function getStatus() {
  const halted = await isHalted();
  const reason = halted ? await getReason() : null;
  return {
    halted,
    reason,
    source: envHalted() ? 'env' : (halted ? 'runtime' : null),
    tradingMode: config.app.tradingMode,
    timestamp: Date.now(),
  };
}

async function halt(reason = 'manual') {
  await redisClient.set(KEY, '1');
  await redisClient.set(REASON_KEY, String(reason).slice(0, 200));
  logger.warn(`🛑 KILL SWITCH ENGAGED — ${reason}`);
  emitEvent('killSwitch', { halted: true, reason, timestamp: Date.now() });
  return getStatus();
}

async function resume(actor = 'manual') {
  if (envHalted()) {
    throw new Error('Cannot resume: TRADING_HALTED env flag is set. Restart with the env unset.');
  }
  await redisClient.del(KEY);
  await redisClient.del(REASON_KEY);
  logger.warn(`✅ KILL SWITCH RELEASED by ${actor}`);
  emitEvent('killSwitch', { halted: false, actor, timestamp: Date.now() });
  return getStatus();
}

/**
 * Auto-trip helpers — risk engine and analytics service can call these
 * to engage the switch when invariants break.
 */
async function tripIfDailyLossExceeded(dailyLossPercent) {
  if (dailyLossPercent >= config.risk.maxDailyLossPercent) {
    await halt(`daily loss ${dailyLossPercent}% ≥ limit ${config.risk.maxDailyLossPercent}%`);
    return true;
  }
  return false;
}

async function tripIfConsecutiveLosses(count, threshold = 5) {
  if (count >= threshold) {
    await halt(`${count} consecutive losing trades (threshold ${threshold})`);
    return true;
  }
  return false;
}

module.exports = {
  isHalted,
  getStatus,
  getReason,
  halt,
  resume,
  tripIfDailyLossExceeded,
  tripIfConsecutiveLosses,
};
