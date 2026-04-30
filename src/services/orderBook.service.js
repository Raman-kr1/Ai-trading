/**
 * In-Memory Order Book Service (HFT)
 * =====================================
 * Maintains a real-time, in-memory snapshot of market state per symbol.
 * Eliminates Redis round-trips for the hottest data in the trading pipeline.
 *
 * Features:
 *   - Candle storage in CircularBuffer (O(1) push, no GC)
 *   - Incremental indicator updates (avoids full recomputation)
 *   - Best bid/ask tracking from WebSocket depth streams
 *   - Tick-level event emitter for downstream consumers
 */

const EventEmitter = require('events');
const { CircularBuffer, LatencyTracker } = require('../utils/performance');
const { roundTo } = require('../utils/helpers');
const logger = require('../utils/logger');

// ─── Incremental EMA ──────────────────────────────────────────
// Standard EMA formula: EMA = close * k + prevEMA * (1 - k)
// where k = 2 / (period + 1)
// This avoids re-scanning the entire candle array on each tick.

class IncrementalEMA {
  constructor(period) {
    this.period = period;
    this.k = 2 / (period + 1);
    this.value = null;
    this._count = 0;
    this._sum = 0;
  }

  /** Feed a new close price. Returns current EMA. */
  update(close) {
    this._count++;
    if (this._count <= this.period) {
      // Seed with SMA for the first `period` values
      this._sum += close;
      if (this._count === this.period) {
        this.value = this._sum / this.period;
      }
      return this.value;
    }
    this.value = close * this.k + this.value * (1 - this.k);
    return this.value;
  }

  reset() {
    this.value = null;
    this._count = 0;
    this._sum = 0;
  }
}

// ─── Incremental RSI ──────────────────────────────────────────
// Wilder's smoothed RSI with incremental gain/loss tracking.
// Only needs the current and previous close price.

class IncrementalRSI {
  constructor(period = 14) {
    this.period = period;
    this.avgGain = null;
    this.avgLoss = null;
    this.value = null;
    this._prevClose = null;
    this._gains = [];
    this._losses = [];
  }

  /** Feed a new close price. Returns current RSI or null if not enough data. */
  update(close) {
    if (this._prevClose === null) {
      this._prevClose = close;
      return null;
    }

    const change = close - this._prevClose;
    this._prevClose = close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    if (this.avgGain === null) {
      // Accumulate initial period
      this._gains.push(gain);
      this._losses.push(loss);
      if (this._gains.length === this.period) {
        this.avgGain = this._gains.reduce((a, b) => a + b, 0) / this.period;
        this.avgLoss = this._losses.reduce((a, b) => a + b, 0) / this.period;
        this._gains = null; // Free memory
        this._losses = null;
        const rs = this.avgLoss === 0 ? 100 : this.avgGain / this.avgLoss;
        this.value = roundTo(100 - (100 / (1 + rs)), 2);
      }
      return this.value;
    }

    // Wilder's smoothing: avgGain = (prevAvgGain * (period-1) + currentGain) / period
    this.avgGain = (this.avgGain * (this.period - 1) + gain) / this.period;
    this.avgLoss = (this.avgLoss * (this.period - 1) + loss) / this.period;
    const rs = this.avgLoss === 0 ? 100 : this.avgGain / this.avgLoss;
    this.value = roundTo(100 - (100 / (1 + rs)), 2);
    return this.value;
  }

  reset() {
    this.avgGain = null;
    this.avgLoss = null;
    this.value = null;
    this._prevClose = null;
    this._gains = [];
    this._losses = [];
  }
}

// ─── Incremental VWAP ─────────────────────────────────────────

class IncrementalVWAP {
  constructor() {
    this.cumTPV = 0;
    this.cumVolume = 0;
    this.value = null;
  }

  update(high, low, close, volume) {
    const tp = (high + low + close) / 3;
    this.cumTPV += tp * volume;
    this.cumVolume += volume;
    this.value = this.cumVolume > 0 ? roundTo(this.cumTPV / this.cumVolume, 4) : null;
    return this.value;
  }

  /** Reset at session start (VWAP resets daily). */
  reset() {
    this.cumTPV = 0;
    this.cumVolume = 0;
    this.value = null;
  }
}

// ─── Symbol Book ──────────────────────────────────────────────
// Per-symbol real-time state container.

class SymbolBook extends EventEmitter {
  /**
   * @param {string} symbol   - Trading pair (e.g. BTCUSDT)
   * @param {Object} options
   * @param {number} options.candleCapacity - CircularBuffer size (default 200)
   */
  constructor(symbol, options = {}) {
    super();
    this.symbol = symbol;
    this.candleCapacity = options.candleCapacity || 200;

    // Candle storage (ring buffer — never grows, never GCs)
    this.candles = new CircularBuffer(this.candleCapacity);

    // Incremental indicators (updated on each tick, no recomputation)
    this.ema20 = new IncrementalEMA(20);
    this.ema50 = new IncrementalEMA(50);
    this.rsi = new IncrementalRSI(14);
    this.vwap = new IncrementalVWAP();

    // MACD components (EMA12, EMA26, Signal EMA9)
    this._macdFast = new IncrementalEMA(12);
    this._macdSlow = new IncrementalEMA(26);
    this._macdSignal = new IncrementalEMA(9);
    this.macd = null;

    // Latest tick state
    this.lastPrice = 0;
    this.lastVolume = 0;
    this.bestBid = 0;
    this.bestAsk = 0;
    this.spread = 0;
    this.tickCount = 0;
    this.lastUpdate = 0;

    // Latency tracking per symbol
    this._latency = new LatencyTracker(`book:${symbol}`);
  }

  /**
   * Process a new candle (from WebSocket or REST).
   * Updates all incremental indicators in a single pass.
   * This is the HOT PATH — every microsecond matters.
   */
  onCandle(candle) {
    const t = this._latency.start();

    this.candles.push(candle);
    this.lastPrice = candle.close;
    this.lastVolume = candle.volume;
    this.lastUpdate = Date.now();
    this.tickCount++;

    // Update all indicators incrementally (NO full recomputation)
    const ema20Val = this.ema20.update(candle.close);
    const ema50Val = this.ema50.update(candle.close);
    const rsiVal = this.rsi.update(candle.close);
    this.vwap.update(candle.high, candle.low, candle.close, candle.volume);

    // MACD: difference of EMA12 and EMA26, then EMA9 of that
    const fastEma = this._macdFast.update(candle.close);
    const slowEma = this._macdSlow.update(candle.close);
    if (fastEma !== null && slowEma !== null) {
      const macdLine = fastEma - slowEma;
      const signalLine = this._macdSignal.update(macdLine);
      if (signalLine !== null) {
        this.macd = {
          line: roundTo(macdLine, 4),
          signal: roundTo(signalLine, 4),
          histogram: roundTo(macdLine - signalLine, 4),
        };
      }
    }

    const elapsed = this._latency.end(t);

    // Emit tick event for downstream consumers (HFT orchestrator)
    this.emit('tick', {
      symbol: this.symbol,
      candle,
      indicators: this.getIndicatorSnapshot(),
      latencyUs: elapsed,
    });
  }

  /**
   * Update best bid/ask from order book depth stream.
   */
  onDepth(bid, ask) {
    this.bestBid = bid;
    this.bestAsk = ask;
    this.spread = ask - bid;
  }

  /**
   * Get a complete indicator snapshot (what the AI engine needs).
   * Built from incremental state — NO recomputation.
   */
  getIndicatorSnapshot() {
    const cp = this.lastPrice;
    const prev = this.candles.size >= 2 ? this.candles.lastN(2)[0]?.close : cp;

    const indicators = {
      rsi: this.rsi.value,
      macd: this.macd,
      ema20: this.ema20.value !== null ? roundTo(this.ema20.value, 4) : null,
      ema50: this.ema50.value !== null ? roundTo(this.ema50.value, 4) : null,
      vwap: this.vwap.value,
      sma20: null, // Omitted in HFT mode for speed; use EMA20 instead
      currentPrice: roundTo(cp, 4),
      previousPrice: roundTo(prev, 4),
      priceChange: roundTo(cp - prev, 4),
      priceChangePercent: prev ? roundTo(((cp - prev) / prev) * 100, 4) : 0,
      candleCount: this.candles.size,
      latestTimestamp: Date.now(),
      signals: {},
      // HFT-specific fields
      bestBid: this.bestBid,
      bestAsk: this.bestAsk,
      spread: roundTo(this.spread, 4),
      tickCount: this.tickCount,
    };

    // Derive signals inline
    if (indicators.rsi !== null) {
      indicators.signals.rsi = indicators.rsi > 70 ? 'OVERBOUGHT' : indicators.rsi < 30 ? 'OVERSOLD' : 'NEUTRAL';
    }
    if (indicators.macd) {
      indicators.signals.macd = (indicators.macd.histogram > 0 && indicators.macd.line > indicators.macd.signal) ? 'BULLISH' : (indicators.macd.histogram < 0) ? 'BEARISH' : 'NEUTRAL';
    }
    if (indicators.ema20 !== null && indicators.ema50 !== null) {
      indicators.signals.emaCrossover = indicators.ema20 > indicators.ema50 ? 'BULLISH' : 'BEARISH';
    }
    if (indicators.vwap !== null) {
      indicators.signals.vwap = cp > indicators.vwap ? 'ABOVE_VWAP' : 'BELOW_VWAP';
    }

    return indicators;
  }

  /** Get the last N candles for AI context. */
  getRecentCandles(n = 5) {
    return this.candles.lastN(n);
  }

  /** Get latency statistics. */
  getLatencyStats() {
    return this._latency.getStats();
  }

  /** Reset daily (VWAP, counters). */
  resetDaily() {
    this.vwap.reset();
    this.tickCount = 0;
    logger.info(`Daily reset: ${this.symbol}`);
  }
}

// ─── Order Book Manager ───────────────────────────────────────
// Manages SymbolBook instances for all watched symbols.

class OrderBookManager {
  constructor() {
    this._books = new Map();
  }

  /** Get or create a SymbolBook. */
  getBook(symbol) {
    if (!this._books.has(symbol)) {
      this._books.set(symbol, new SymbolBook(symbol));
      logger.info(`📖 Order book created: ${symbol}`);
    }
    return this._books.get(symbol);
  }

  /** Get all active symbols. */
  getSymbols() {
    return Array.from(this._books.keys());
  }

  /** Get all latency stats. */
  getAllLatencyStats() {
    const stats = {};
    for (const [symbol, book] of this._books) {
      stats[symbol] = book.getLatencyStats();
    }
    return stats;
  }

  /** Reset all books for a new trading day. */
  resetDaily() {
    for (const book of this._books.values()) {
      book.resetDaily();
    }
  }
}

// Singleton instance
const orderBookManager = new OrderBookManager();

module.exports = {
  SymbolBook,
  OrderBookManager,
  orderBookManager,
  IncrementalEMA,
  IncrementalRSI,
  IncrementalVWAP,
};
