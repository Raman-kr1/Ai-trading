/**
 * HFT Trading Orchestrator
 * ==========================
 * High-frequency trading pipeline that bypasses BullMQ for sub-second execution.
 *
 * Architecture:
 *   WebSocket ticks → OrderBook (in-memory) → Signal Detection → Risk Gate → Execute
 *
 * Key optimizations:
 *   1. Event-driven (no polling) — reacts to WebSocket ticks
 *   2. Indicators pre-computed incrementally in OrderBook
 *   3. AI decisions cached with TTL to avoid latency on repeat patterns
 *   4. Pre-built order templates ready to fire
 *   5. Parallel risk checks (in-memory daily PnL tracking)
 *   6. Full pipeline latency tracking at nanosecond precision
 */

const EventEmitter = require('events');
const WebSocket = require('ws');
const config = require('../config');
const { orderBookManager } = require('./orderBook.service');
const aiService = require('./ai.service');
const executionService = require('./execution.service');
const Trade = require('../models/trade.model');
const Decision = require('../models/decision.model');
const { LatencyTracker, fastParseBinanceKline } = require('../utils/performance');
const { roundTo, generateTradeId } = require('../utils/helpers');
const { cache } = require('../config/redis');
const logger = require('../utils/logger');

class HFTOrchestrator extends EventEmitter {
  constructor(options = {}) {
    super();

    // Configuration
    this.symbols = options.symbols || ['BTCUSDT', 'ETHUSDT'];
    this.exchange = options.exchange || 'binance';
    this.capital = options.capital || 10000;
    this.interval = options.interval || '1m';
    this.aiCooldownMs = options.aiCooldownMs || 5000;  // Min time between AI calls per symbol
    this.enabled = false;

    // WebSocket connections
    this._wsConnections = new Map();

    // AI decision cache (avoid redundant Claude API calls)
    this._aiCache = new Map();         // symbol → { decision, timestamp }
    this._lastAiCall = new Map();      // symbol → timestamp

    // In-memory risk state (avoids MongoDB round-trips)
    this._dailyPnL = 0;
    this._openPositionCount = 0;
    this._openPositions = new Map();   // symbol → trade

    // Pipeline latency trackers
    this._latency = {
      total: new LatencyTracker('pipeline:total'),
      signal: new LatencyTracker('pipeline:signal_detect'),
      ai: new LatencyTracker('pipeline:ai_decision'),
      risk: new LatencyTracker('pipeline:risk_check'),
      execution: new LatencyTracker('pipeline:execution'),
    };

    // Stats
    this._ticksProcessed = 0;
    this._signalsDetected = 0;
    this._tradesExecuted = 0;
    this._tradesRejected = 0;
  }

  // ─── Lifecycle ─────────────────────────────────────────────

  /**
   * Start the HFT orchestrator.
   * Opens WebSocket streams and begins processing.
   */
  async start() {
    logger.info(`🚀 HFT Orchestrator starting | Symbols: ${this.symbols.join(', ')} | Mode: ${config.app.tradingMode}`);
    this.enabled = true;

    // Warm up order books with historical data
    await this._warmUpOrderBooks();

    // Connect WebSocket streams for all symbols
    for (const symbol of this.symbols) {
      this._connectStream(symbol);
    }

    // Daily reset scheduler (resets at 00:00 UTC)
    this._scheduleDailyReset();

    // Periodic latency report (every 60s)
    this._latencyReportInterval = setInterval(() => this._reportLatency(), 60000);

    logger.info('✅ HFT Orchestrator running.');
    this.emit('started');
  }

  /**
   * Gracefully stop the orchestrator.
   */
  async stop() {
    logger.info('🛑 HFT Orchestrator stopping...');
    this.enabled = false;

    // Close all WebSocket connections
    for (const [symbol, ws] of this._wsConnections) {
      ws.close();
      logger.info(`WebSocket closed: ${symbol}`);
    }
    this._wsConnections.clear();

    if (this._latencyReportInterval) clearInterval(this._latencyReportInterval);
    if (this._dailyResetTimeout) clearTimeout(this._dailyResetTimeout);

    this.emit('stopped');
    logger.info('✅ HFT Orchestrator stopped.');
  }

  // ─── WebSocket Connection ──────────────────────────────────

  _connectStream(symbol) {
    const wsUrl = `${config.binance.wsUrl}/${symbol.toLowerCase()}@kline_${this.interval}`;
    const ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      logger.info(`⚡ HFT WebSocket connected: ${symbol}`);
    });

    ws.on('message', (rawData) => {
      if (!this.enabled) return;

      // Fast-parse: try optimized parser first, fallback to JSON.parse
      let candle = fastParseBinanceKline(rawData);
      if (!candle) {
        try {
          const parsed = JSON.parse(rawData);
          const k = parsed.k;
          candle = {
            timestamp: k.t, open: parseFloat(k.o), high: parseFloat(k.h),
            low: parseFloat(k.l), close: parseFloat(k.c), volume: parseFloat(k.v),
            isClosed: k.x, source: 'binance',
          };
        } catch (e) { return; }
      }

      // Feed into order book (incremental indicator update)
      const book = orderBookManager.getBook(symbol);
      book.onCandle(candle);

      this._ticksProcessed++;

      // Only evaluate on CLOSED candles (reduces noise by ~60x for 1m candles)
      if (candle.isClosed) {
        this._onClosedCandle(symbol, candle);
      }
    });

    ws.on('error', (err) => {
      logger.error(`HFT WebSocket error: ${symbol}`, { error: err.message });
    });

    ws.on('close', () => {
      if (this.enabled) {
        logger.warn(`HFT WebSocket closed: ${symbol}. Reconnecting in 1s...`);
        setTimeout(() => this._connectStream(symbol), 1000); // Faster reconnect for HFT
      }
    });

    this._wsConnections.set(symbol, ws);
  }

  // ─── Core Pipeline (Hot Path) ──────────────────────────────

  async _onClosedCandle(symbol, candle) {
    const pipelineStart = this._latency.total.start();

    try {
      const book = orderBookManager.getBook(symbol);
      const indicators = book.getIndicatorSnapshot();

      // Step 1: Signal Detection (in-memory, sub-microsecond)
      const sigStart = this._latency.signal.start();
      const signal = this._detectSignal(symbol, indicators);
      this._latency.signal.end(sigStart);

      if (!signal) {
        this._latency.total.end(pipelineStart);
        return;
      }

      this._signalsDetected++;

      // Step 2: AI Cooldown check (avoid spamming Claude API)
      const lastCall = this._lastAiCall.get(symbol) || 0;
      if (Date.now() - lastCall < this.aiCooldownMs) {
        this._latency.total.end(pipelineStart);
        return;
      }

      // Step 3: Get AI Decision (with caching)
      const aiStart = this._latency.ai.start();
      const decision = await this._getAIDecision(symbol, indicators, book.getRecentCandles(5));
      this._latency.ai.end(aiStart);

      if (decision.decision === 'HOLD') {
        this._latency.total.end(pipelineStart);
        return;
      }

      // Step 4: Risk Gate (in-memory, sub-millisecond)
      const riskStart = this._latency.risk.start();
      const riskResult = this._fastRiskCheck(decision, symbol);
      this._latency.risk.end(riskStart);

      // Log the decision
      this._logDecision(symbol, indicators, decision, riskResult);

      if (!riskResult.approved) {
        this._tradesRejected++;
        logger.info(`❌ HFT Trade REJECTED: ${symbol}`, { reasons: riskResult.reasons });
        this._latency.total.end(pipelineStart);
        return;
      }

      // Step 5: Execute
      const execStart = this._latency.execution.start();
      await this._executeFast(symbol, decision, riskResult);
      this._latency.execution.end(execStart);

      this._tradesExecuted++;

    } catch (error) {
      logger.error(`HFT pipeline error: ${symbol}`, { error: error.message });
    }

    this._latency.total.end(pipelineStart);
  }

  // ─── Signal Detection ──────────────────────────────────────
  // Quick heuristic filter to avoid unnecessary AI calls.
  // Only proceeds if multiple indicators converge.

  _detectSignal(symbol, indicators) {
    if (!indicators.rsi || !indicators.macd || !indicators.ema20) return null;

    const signals = indicators.signals;
    let bullCount = 0;
    let bearCount = 0;

    if (signals.rsi === 'OVERSOLD') bullCount++;
    if (signals.rsi === 'OVERBOUGHT') bearCount++;
    if (signals.macd === 'BULLISH') bullCount++;
    if (signals.macd === 'BEARISH') bearCount++;
    if (signals.emaCrossover === 'BULLISH') bullCount++;
    if (signals.emaCrossover === 'BEARISH') bearCount++;
    if (signals.vwap === 'ABOVE_VWAP') bullCount++;
    if (signals.vwap === 'BELOW_VWAP') bearCount++;

    // Require at least 3 converging signals
    if (bullCount >= 3) return { direction: 'BUY', strength: bullCount };
    if (bearCount >= 3) return { direction: 'SELL', strength: bearCount };

    return null;
  }

  // ─── AI Decision (Cached) ─────────────────────────────────

  async _getAIDecision(symbol, indicators, recentCandles) {
    this._lastAiCall.set(symbol, Date.now());

    // Check AI cache
    const cached = this._aiCache.get(symbol);
    if (cached && (Date.now() - cached.timestamp) < this.aiCooldownMs) {
      return cached.decision;
    }

    const decision = await aiService.getTradeDecision(symbol, indicators, recentCandles, this.exchange);

    // Cache the decision
    this._aiCache.set(symbol, { decision, timestamp: Date.now() });

    return decision;
  }

  // ─── Fast Risk Check (In-Memory) ───────────────────────────
  // Mirrors risk.service.js rules but uses in-memory state.
  // Avoids MongoDB queries entirely.

  _fastRiskCheck(decision, symbol) {
    const reasons = [];
    const metrics = {};

    // Rule 1: Risk/Reward ratio
    const risk = Math.abs(decision.entry_price - decision.stop_loss);
    const reward = Math.abs(decision.target_price - decision.entry_price);
    metrics.riskRewardRatio = risk > 0 ? roundTo(reward / risk, 2) : 0;
    if (metrics.riskRewardRatio < config.risk.minRiskRewardRatio) {
      reasons.push(`R:R ${metrics.riskRewardRatio}:1 < ${config.risk.minRiskRewardRatio}:1`);
    }

    // Rule 2: Confidence
    metrics.confidence = decision.confidence;
    if (decision.confidence < config.risk.minConfidenceScore) {
      reasons.push(`Confidence ${decision.confidence}% < ${config.risk.minConfidenceScore}%`);
    }

    // Rule 3: Daily loss (in-memory tracker)
    metrics.dailyLossPercent = this.capital > 0 ? roundTo((Math.abs(Math.min(this._dailyPnL, 0)) / this.capital) * 100, 2) : 0;
    if (this._dailyPnL < 0 && metrics.dailyLossPercent >= config.risk.maxDailyLossPercent) {
      reasons.push(`Daily loss ${metrics.dailyLossPercent}% ≥ ${config.risk.maxDailyLossPercent}%`);
    }

    // Rule 4: Position size
    const quantity = this._calculatePositionSize(decision);
    const positionValue = decision.entry_price * quantity;
    metrics.positionPercent = this.capital > 0 ? roundTo((positionValue / this.capital) * 100, 2) : 100;
    if (metrics.positionPercent > config.risk.maxTradeSizePercent) {
      reasons.push(`Position ${metrics.positionPercent}% > ${config.risk.maxTradeSizePercent}%`);
    }

    // Rule 5: Max open positions
    metrics.openPositions = this._openPositionCount;
    if (this._openPositionCount >= config.risk.maxOpenPositions) {
      reasons.push(`Open positions (${this._openPositionCount}) at max (${config.risk.maxOpenPositions})`);
    }

    // Rule 6: Already in a position for this symbol
    if (this._openPositions.has(symbol)) {
      reasons.push(`Already in position for ${symbol}`);
    }

    // Rule 7: Price level validation
    if (decision.decision === 'BUY') {
      if (decision.stop_loss >= decision.entry_price) reasons.push('BUY: SL must be below entry');
      if (decision.target_price <= decision.entry_price) reasons.push('BUY: TP must be above entry');
    }
    if (decision.decision === 'SELL') {
      if (decision.stop_loss <= decision.entry_price) reasons.push('SELL: SL must be above entry');
      if (decision.target_price >= decision.entry_price) reasons.push('SELL: TP must be below entry');
    }

    return {
      approved: reasons.length === 0,
      reasons,
      riskMetrics: metrics,
      quantity,
    };
  }

  _calculatePositionSize(decision) {
    const maxRiskAmount = this.capital * (config.risk.maxTradeSizePercent / 100);
    const riskPerUnit = Math.abs(decision.entry_price - decision.stop_loss);
    if (riskPerUnit === 0) return 0;
    return Math.floor(maxRiskAmount / riskPerUnit);
  }

  // ─── Fast Execution ────────────────────────────────────────

  async _executeFast(symbol, decision, riskResult) {
    const tradeId = generateTradeId();
    const quantity = riskResult.quantity;

    try {
      const trade = await executionService.executeTrade({
        symbol,
        exchange: this.exchange,
        decision,
        riskCheck: riskResult,
        quantity,
        aiDecisionId: null, // Will be updated after async DB write
      });

      // Update in-memory state
      this._openPositions.set(symbol, trade);
      this._openPositionCount++;

      logger.info(`⚡ HFT Trade EXECUTED: ${trade.tradeId}`, {
        symbol, side: decision.decision, confidence: decision.confidence,
      });

      return trade;
    } catch (error) {
      logger.error(`HFT execution failed: ${symbol}`, { error: error.message });
      throw error;
    }
  }

  // ─── Async Logging (Non-Blocking) ──────────────────────────
  // Decision logging is fire-and-forget to not block the pipeline.

  _logDecision(symbol, indicators, decision, riskResult) {
    // Fire-and-forget — don't await
    Decision.create({
      symbol, exchange: this.exchange, timeframe: this.interval,
      decision: decision.decision, entryPrice: decision.entry_price,
      stopLoss: decision.stop_loss, targetPrice: decision.target_price,
      confidence: decision.confidence, reasoning: decision.reasoning,
      indicators: {
        rsi: indicators.rsi, macd: indicators.macd,
        ema20: indicators.ema20, ema50: indicators.ema50,
        vwap: indicators.vwap, currentPrice: indicators.currentPrice,
      },
      riskApproved: riskResult.approved,
      riskReasons: riskResult.reasons,
      model: decision._meta?.model,
      latencyMs: decision._meta?.latencyMs,
    }).catch((err) => logger.error('Async decision log failed:', { error: err.message }));
  }

  // ─── Warm-Up ───────────────────────────────────────────────

  async _warmUpOrderBooks() {
    logger.info('🔥 Warming up order books with historical data...');

    for (const symbol of this.symbols) {
      try {
        const { fetchBinanceKlines } = require('./marketData.service');
        const candles = await fetchBinanceKlines(symbol, this.interval, 200);

        const book = orderBookManager.getBook(symbol);
        for (const candle of candles) {
          book.onCandle(candle); // Seeds all incremental indicators
        }

        logger.info(`  ✅ ${symbol}: ${candles.length} candles loaded, indicators seeded`);
      } catch (error) {
        logger.warn(`  ⚠️ ${symbol}: warm-up failed — ${error.message}`);
      }
    }
  }

  // ─── Daily Reset ───────────────────────────────────────────

  _scheduleDailyReset() {
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setUTCHours(0, 0, 0, 0);
    nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
    const msUntilReset = nextMidnight - now;

    this._dailyResetTimeout = setTimeout(() => {
      this._dailyPnL = 0;
      orderBookManager.resetDaily();
      logger.info('📅 Daily reset completed (PnL and VWAP reset).');
      this._scheduleDailyReset(); // Reschedule for next day
    }, msUntilReset);

    logger.info(`Daily reset scheduled in ${Math.round(msUntilReset / 60000)} minutes.`);
  }

  // ─── Latency Reporting ─────────────────────────────────────

  _reportLatency() {
    logger.info(`\n📊 HFT Latency Report | Ticks: ${this._ticksProcessed} | Signals: ${this._signalsDetected} | Trades: ${this._tradesExecuted} | Rejected: ${this._tradesRejected}`);
    for (const tracker of Object.values(this._latency)) {
      tracker.logStats();
    }
    // Book-level latency
    const bookStats = orderBookManager.getAllLatencyStats();
    for (const [symbol, stats] of Object.entries(bookStats)) {
      if (stats.count > 0) {
        logger.info(`  ⏱ ${symbol}: avg=${stats.avg_us}μs p99=${stats.p99_us}μs (${stats.count} ticks)`);
      }
    }
  }

  // ─── Public API ────────────────────────────────────────────

  /** Get orchestrator status. */
  getStatus() {
    return {
      enabled: this.enabled,
      symbols: this.symbols,
      exchange: this.exchange,
      mode: config.app.tradingMode,
      ticksProcessed: this._ticksProcessed,
      signalsDetected: this._signalsDetected,
      tradesExecuted: this._tradesExecuted,
      tradesRejected: this._tradesRejected,
      dailyPnL: roundTo(this._dailyPnL, 2),
      openPositions: this._openPositionCount,
      latency: Object.fromEntries(
        Object.entries(this._latency).map(([k, v]) => [k, v.getStats()])
      ),
    };
  }

  /** Update capital (e.g. after trade close). */
  updateCapital(amount) {
    this.capital += amount;
    this._dailyPnL += amount;
  }

  /** Close a position and update in-memory state. */
  closePosition(symbol, pnl) {
    this._openPositions.delete(symbol);
    this._openPositionCount = Math.max(0, this._openPositionCount - 1);
    this.updateCapital(pnl);
  }
}

module.exports = { HFTOrchestrator };
