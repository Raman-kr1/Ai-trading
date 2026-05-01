/**
 * Market Scanner
 * ===============
 * One cycle = walk every active watchlist asset, pull its candles,
 * compute indicators, ask Claude (with historical context) for a
 * decision, then rank the BUY/SELL signals so the worker can act on
 * the best ones first.
 *
 * Score model: confidence × min(riskReward, 5).
 *   - confidence dominates because a low-confidence 4:1 setup is still
 *     a guess.
 *   - riskReward is capped at 5 so a Claude hallucination of "target
 *     20× away" can't blow up the leaderboard.
 *   - HOLDs and signals with non-positive risk/reward score 0 and sink
 *     to the bottom but stay in the result for transparency.
 */

'use strict';

const watchlist = require('../config/watchlist');
const marketDataService = require('./marketData.service');
const indicatorService = require('./indicator.service');
const aiService = require('./ai.service');
const contextMemory = require('./contextMemory.service');
const Decision = require('../models/decision.model');
const logger = require('../utils/logger');

const MIN_CANDLES = 26; // smallest window the indicator suite needs

async function fetchCandles(asset) {
  if (asset.exchange === 'binance') {
    return marketDataService.fetchBinanceKlines(asset.symbol, asset.timeframe || '1m', 100);
  }
  if (asset.exchange === 'zerodha') {
    const tfMap = { '1m': 'minute', '5m': '5minute', '15m': '15minute', '1h': 'hour', '1d': 'day' };
    const interval = tfMap[asset.timeframe] || '5minute';
    return marketDataService.fetchZerodhaCandles(asset.instrumentToken, interval);
  }
  throw new Error(`Unsupported exchange: ${asset.exchange}`);
}

function scoreOpportunity(decision) {
  if (!decision || decision.decision === 'HOLD') return 0;
  const risk = Math.abs(decision.entry_price - decision.stop_loss);
  const reward = Math.abs(decision.target_price - decision.entry_price);
  if (risk <= 0 || reward <= 0) return 0;
  const rr = Math.min(reward / risk, 5);
  return Math.round((decision.confidence || 0) * rr * 100) / 100;
}

/**
 * Analyze a single asset end-to-end. Never throws — failures degrade
 * to a status entry so a single broken symbol can't sink the cycle.
 */
async function analyzeAsset(asset) {
  const base = {
    id: asset.id,
    symbol: asset.symbol,
    exchange: asset.exchange,
    assetClass: asset.assetClass,
  };

  if (!watchlist.isMarketOpen(asset)) {
    return { ...base, status: 'closed-market', score: 0 };
  }

  try {
    const candles = await fetchCandles(asset);
    if (!candles || candles.length < MIN_CANDLES) {
      return { ...base, status: 'insufficient-data', score: 0 };
    }

    const indicators = indicatorService.computeAllIndicators(candles);
    if (!indicators) {
      return { ...base, status: 'indicator-error', score: 0 };
    }

    // Pull historical context so Claude doesn't repeat losing setups.
    const ctx = await contextMemory.getSymbolContext(asset.symbol).catch(() => null);
    const decision = await aiService.getTradeDecision(
      asset.symbol, indicators, candles, asset.exchange,
    );

    // Persist the decision regardless of execution — keeps the audit
    // trail complete and feeds future context-memory lookups.
    let decisionRecord = null;
    try {
      decisionRecord = await Decision.create({
        symbol: asset.symbol,
        exchange: asset.exchange,
        timeframe: asset.timeframe,
        decision: decision.decision,
        entryPrice: decision.entry_price,
        stopLoss: decision.stop_loss,
        targetPrice: decision.target_price,
        confidence: decision.confidence,
        reasoning: decision.reasoning,
        indicators: {
          rsi: indicators.rsi, macd: indicators.macd,
          ema20: indicators.ema20, ema50: indicators.ema50,
          vwap: indicators.vwap, currentPrice: indicators.currentPrice,
        },
        marketData: candles[candles.length - 1],
        model: decision._meta?.model,
        promptTokens: decision._meta?.promptTokens,
        completionTokens: decision._meta?.completionTokens,
        latencyMs: decision._meta?.latencyMs,
      });
    } catch (e) {
      logger.warn(`scanner: failed to persist decision for ${asset.symbol}: ${e.message}`);
    }

    return {
      ...base,
      status: 'analyzed',
      decision,
      decisionId: decisionRecord?._id,
      indicators,
      currentPrice: indicators.currentPrice,
      score: scoreOpportunity(decision),
      contextSummary: ctx ? {
        openPositions: ctx.openPositions?.length || 0,
        dailyPnL: ctx.dailyStats?.pnl || 0,
        recentTrades: ctx.recentTrades?.length || 0,
      } : null,
    };
  } catch (error) {
    logger.error(`scanner: ${asset.symbol} failed: ${error.message}`);
    return { ...base, status: 'error', error: error.message, score: 0 };
  }
}

/**
 * Run one full scan. Returns a sorted opportunity list.
 *   topN — only this many results are flagged "actionable" via the
 *   `actionable` boolean. The full list is always returned so callers
 *   (UI, audit) can see everything that was considered.
 */
async function runCycle({ topN = 3 } = {}) {
  const assets = watchlist.getActive();
  const startedAt = Date.now();
  logger.info(`🔭 Scanner cycle start — ${assets.length} asset(s)`);

  const results = await Promise.all(assets.map(analyzeAsset));

  results.sort((a, b) => (b.score || 0) - (a.score || 0));

  let flagged = 0;
  for (const r of results) {
    const tradable = r.status === 'analyzed'
      && r.decision
      && r.decision.decision !== 'HOLD'
      && r.score > 0;
    r.actionable = tradable && flagged < topN;
    if (r.actionable) flagged += 1;
  }

  const elapsed = Date.now() - startedAt;
  logger.info(
    `🔭 Scanner cycle done in ${elapsed}ms — ${flagged} actionable / ${results.length} scanned`
  );

  return {
    scannedAt: new Date(),
    elapsedMs: elapsed,
    count: results.length,
    actionableCount: flagged,
    opportunities: results,
  };
}

module.exports = { runCycle, analyzeAsset, scoreOpportunity };
