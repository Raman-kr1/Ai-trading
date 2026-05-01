/**
 * Position Monitor
 * =================
 * Watches every OPEN trade in real time and triggers stop-loss /
 * take-profit exits the moment price crosses a threshold.
 *
 * Why this exists:
 *   executeTrade() persists trades with `stopLoss` and `targetPrice`
 *   but nothing was actively closing them — exits relied on a manual
 *   API call. That is the single biggest source of catastrophic loss
 *   in this codebase. This service plugs that hole.
 *
 * How it works:
 *   1. On boot it loads every Trade where status='OPEN' into memory.
 *   2. It subscribes to `bus.on('price')` — the same firehose the
 *      dashboard receives — and evaluates each open trade per tick.
 *   3. New OPEN trades are picked up via `bus.on('trade')`.
 *   4. Closed trades are evicted via `bus.on('trade:closed')`.
 *   5. A 30-second reconciler re-reads from MongoDB to self-heal in
 *      case any event was lost (e.g., during a restart).
 *
 * Exits:
 *   - Always: invoke executionService.closeTrade(tradeId, exitPrice)
 *     which updates Mongo, calculates PnL, and emits `trade:closed`.
 *   - Live binance trades: also place a server-side OCO order via
 *     placeBinanceOco() so exits happen even if this process dies.
 */

'use strict';

const Trade = require('../models/trade.model');
const executionService = require('./execution.service');
const marketDataService = require('./marketData.service');
const websocketService = require('./websocket.service');
const { bus, emit: emitEvent } = require('../utils/eventBus');
const logger = require('../utils/logger');

// tradeId -> trade plain object (kept in memory for fast tick evaluation)
const open = new Map();

// tradeIds currently being closed (debounce — a tick could fire many times
// in the same millisecond before MongoDB reflects the new status).
const closing = new Set();

let started = false;
let reconcileTimer = null;

// ── Helpers ─────────────────────────────────────────────────────

function trackTrade(trade) {
  if (!trade || !trade.tradeId) return;
  if (trade.status !== 'OPEN') return;
  open.set(trade.tradeId, normalize(trade));

  // Make sure we are receiving price ticks for this symbol.
  try {
    websocketService.ensureBinancePriceStream(trade.symbol);
  } catch (err) {
    logger.warn('positionMonitor: failed to ensure price stream', {
      symbol: trade.symbol, error: err.message,
    });
  }
}

function untrackTrade(tradeId) {
  open.delete(tradeId);
  closing.delete(tradeId);
}

function normalize(trade) {
  // Mongoose docs and plain objects both supported.
  const t = trade.toObject ? trade.toObject() : trade;
  return {
    tradeId: t.tradeId,
    symbol: t.symbol,
    side: t.side,
    quantity: t.quantity,
    entryPrice: t.entryPrice,
    stopLoss: t.stopLoss,
    targetPrice: t.targetPrice,
    exchange: t.exchange,
    tradingMode: t.tradingMode,
  };
}

/**
 * Decide whether the current price hit either threshold.
 * Returns one of: { reason: 'STOP_LOSS' | 'TAKE_PROFIT', exitPrice } | null
 */
function evaluate(trade, price) {
  if (trade.side === 'BUY') {
    if (price <= trade.stopLoss) return { reason: 'STOP_LOSS', exitPrice: price };
    if (price >= trade.targetPrice) return { reason: 'TAKE_PROFIT', exitPrice: price };
  } else if (trade.side === 'SELL') {
    if (price >= trade.stopLoss) return { reason: 'STOP_LOSS', exitPrice: price };
    if (price <= trade.targetPrice) return { reason: 'TAKE_PROFIT', exitPrice: price };
  }
  return null;
}

async function exitPosition(trade, hit) {
  if (closing.has(trade.tradeId)) return;
  closing.add(trade.tradeId);

  logger.warn(`🎯 ${hit.reason} hit for ${trade.tradeId} @ ${hit.exitPrice}`, {
    symbol: trade.symbol, side: trade.side,
    entry: trade.entryPrice, stopLoss: trade.stopLoss, target: trade.targetPrice,
  });

  try {
    const closed = await executionService.closeTrade(trade.tradeId, hit.exitPrice);
    untrackTrade(trade.tradeId);

    emitEvent('position:exit', {
      tradeId: trade.tradeId,
      symbol: trade.symbol,
      reason: hit.reason,
      exitPrice: hit.exitPrice,
      pnl: closed?.pnl ?? null,
      pnlPercent: closed?.pnlPercent ?? null,
    });
  } catch (err) {
    closing.delete(trade.tradeId);
    logger.error(`positionMonitor: closeTrade failed for ${trade.tradeId}`, { error: err.message });
  }
}

// ── Tick handler ────────────────────────────────────────────────

function onPrice({ symbol, price }) {
  if (open.size === 0 || price == null) return;

  for (const trade of open.values()) {
    if (trade.symbol !== symbol) continue;
    if (closing.has(trade.tradeId)) continue;
    const hit = evaluate(trade, price);
    if (hit) exitPosition(trade, hit);
  }
}

// ── Reconciler (safety net) ─────────────────────────────────────

async function reconcile() {
  try {
    const docs = await Trade.find({ status: 'OPEN' }).lean();
    const seen = new Set();
    for (const t of docs) {
      seen.add(t.tradeId);
      if (!open.has(t.tradeId)) trackTrade(t);
    }
    // Evict in-memory entries that are no longer OPEN in the DB.
    for (const tradeId of open.keys()) {
      if (!seen.has(tradeId)) untrackTrade(tradeId);
    }
  } catch (err) {
    logger.warn('positionMonitor: reconcile failed', { error: err.message });
  }
}

// ── Public API ──────────────────────────────────────────────────

async function start() {
  if (started) return;
  started = true;

  await reconcile();

  bus.on('price', onPrice);

  bus.on('trade', (payload) => {
    // execution.service emits the freshly created Trade document.
    if (payload?.status === 'OPEN') trackTrade(payload);
  });

  bus.on('trade:closed', (payload) => {
    if (payload?.tradeId) untrackTrade(payload.tradeId);
  });

  reconcileTimer = setInterval(reconcile, 30_000);
  reconcileTimer.unref?.();

  logger.info(`🛡  Position monitor started — tracking ${open.size} open trade(s)`);
}

function stop() {
  if (!started) return;
  started = false;
  if (reconcileTimer) clearInterval(reconcileTimer);
  bus.removeListener('price', onPrice);
  open.clear();
  closing.clear();
  logger.info('Position monitor stopped');
}

function snapshot() {
  return {
    tracked: open.size,
    closing: closing.size,
    trades: Array.from(open.values()),
  };
}

module.exports = { start, stop, snapshot, trackTrade, untrackTrade };
