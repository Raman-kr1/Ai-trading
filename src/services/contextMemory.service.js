/**
 * Context Memory
 * ===============
 * Pulls the recent history Claude needs to reason about a symbol —
 * past trades, recent decisions, current open positions, daily PnL —
 * and packs it into a compact, prompt-friendly text block.
 *
 * Why not just stuff raw documents into the prompt?
 *   - Token economics: a single Decision document is ~2 KB of JSON.
 *   - Signal density: most fields don't influence the next call.
 *   - Stability: a rendered string is easier to cache.
 */

'use strict';

const Trade = require('../models/trade.model');
const Decision = require('../models/decision.model');

/**
 * Gather context for a single symbol.
 * @param {string} symbol
 * @param {Object} opts  { tradesLimit, decisionsLimit, openLimit }
 */
async function getSymbolContext(symbol, opts = {}) {
  const tradesLimit = opts.tradesLimit ?? 10;
  const decisionsLimit = opts.decisionsLimit ?? 5;
  const openLimit = opts.openLimit ?? 5;

  const [recentTrades, recentDecisions, openPositions, dailyStats] = await Promise.all([
    Trade.find({ symbol, status: 'CLOSED' })
      .sort({ closedAt: -1 })
      .limit(tradesLimit)
      .lean()
      .catch(() => []),
    Decision.find({ symbol })
      .sort({ createdAt: -1 })
      .limit(decisionsLimit)
      .lean()
      .catch(() => []),
    Trade.find({ symbol, status: 'OPEN' })
      .limit(openLimit)
      .lean()
      .catch(() => []),
    computeDailyStats(symbol).catch(() => ({ pnl: 0, wins: 0, losses: 0 })),
  ]);

  return {
    symbol,
    recentTrades,
    recentDecisions,
    openPositions,
    dailyStats,
  };
}

async function computeDailyStats(symbol) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const closed = await Trade.find({
    symbol, status: 'CLOSED', closedAt: { $gte: todayStart },
  }).lean();

  const pnl = closed.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const wins = closed.filter((t) => (t.pnl || 0) > 0).length;
  const losses = closed.filter((t) => (t.pnl || 0) < 0).length;
  return { pnl, wins, losses, count: closed.length };
}

/**
 * Render the context object as a compact text block suitable for the
 * Claude user prompt. Keeps token usage predictable.
 */
function formatContextForPrompt(ctx) {
  if (!ctx) return '';
  const lines = [];

  lines.push(`HISTORICAL CONTEXT FOR ${ctx.symbol}:`);

  // Daily stats
  const d = ctx.dailyStats || {};
  lines.push(
    `Today: ${d.count || 0} closed trade(s), PnL ${fmtNum(d.pnl)}, ${d.wins || 0}W / ${d.losses || 0}L`
  );

  // Open positions
  if (ctx.openPositions?.length) {
    lines.push(`\nCurrently open positions (${ctx.openPositions.length}):`);
    for (const p of ctx.openPositions) {
      lines.push(
        `  - ${p.side} ${p.quantity} @ ${fmtNum(p.entryPrice)} | SL ${fmtNum(p.stopLoss)} | TP ${fmtNum(p.targetPrice)}`
      );
    }
  } else {
    lines.push(`\nNo open positions.`);
  }

  // Recent closed trades
  if (ctx.recentTrades?.length) {
    lines.push(`\nLast ${ctx.recentTrades.length} closed trade(s) — outcome → indicator state:`);
    for (const t of ctx.recentTrades) {
      const verdict = (t.pnl || 0) >= 0 ? 'WIN' : 'LOSS';
      lines.push(
        `  - ${verdict} ${t.side} entry ${fmtNum(t.entryPrice)} exit ${fmtNum(t.exitPrice)} pnl ${fmtNum(t.pnl)} (${fmtNum(t.pnlPercent)}%)`
      );
    }
  }

  // Recent AI decisions (executed or rejected)
  if (ctx.recentDecisions?.length) {
    lines.push(`\nLast ${ctx.recentDecisions.length} AI decision(s):`);
    for (const dec of ctx.recentDecisions) {
      const status = dec.executed ? '✅ executed'
        : dec.riskApproved === false ? '❌ risk-rejected'
          : '⏸ unexecuted';
      lines.push(
        `  - ${dec.decision} (conf ${dec.confidence}%) ${status} — ${trim(dec.reasoning, 80)}`
      );
    }
  }

  return lines.join('\n');
}

function fmtNum(v) {
  if (v == null) return '—';
  if (typeof v !== 'number') return String(v);
  if (Math.abs(v) >= 1000) return v.toFixed(2);
  if (Math.abs(v) >= 1) return v.toFixed(4);
  return v.toFixed(6);
}

function trim(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

module.exports = {
  getSymbolContext,
  formatContextForPrompt,
  computeDailyStats,
};
