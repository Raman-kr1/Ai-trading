/**
 * Performance Utilities (HFT)
 * =============================
 * Low-level performance primitives for high-frequency trading:
 *   - CircularBuffer: O(1) append/read candle storage (no array copying)
 *   - LatencyTracker: nanosecond-precision pipeline latency monitoring
 *   - ObjectPool: pre-allocated object recycling to eliminate GC pauses
 *   - ConnectionPool: HTTP keep-alive agent for exchange API calls
 */

const http = require('http');
const https = require('https');
const logger = require('./logger');

// ─── Circular Buffer ───────────────────────────────────────────
// Fixed-size ring buffer for candle data. When full, oldest entries
// are silently overwritten. All operations are O(1).

class CircularBuffer {
  /**
   * @param {number} capacity - Max number of elements (e.g. 200 candles)
   */
  constructor(capacity = 200) {
    this._buf = new Array(capacity);
    this._capacity = capacity;
    this._head = 0;    // Next write position
    this._size = 0;    // Current element count
  }

  /** Append an element. O(1). */
  push(item) {
    this._buf[this._head] = item;
    this._head = (this._head + 1) % this._capacity;
    if (this._size < this._capacity) this._size++;
  }

  /** Get all elements in insertion order. O(n). */
  toArray() {
    if (this._size === 0) return [];
    const result = new Array(this._size);
    const start = (this._head - this._size + this._capacity) % this._capacity;
    for (let i = 0; i < this._size; i++) {
      result[i] = this._buf[(start + i) % this._capacity];
    }
    return result;
  }

  /** Get the most recent element. O(1). */
  latest() {
    if (this._size === 0) return null;
    return this._buf[(this._head - 1 + this._capacity) % this._capacity];
  }

  /** Get the N most recent elements. O(n). */
  lastN(n) {
    const count = Math.min(n, this._size);
    const result = new Array(count);
    for (let i = 0; i < count; i++) {
      result[count - 1 - i] = this._buf[(this._head - 1 - i + this._capacity) % this._capacity];
    }
    return result;
  }

  get size() { return this._size; }
  get capacity() { return this._capacity; }
  get isFull() { return this._size === this._capacity; }

  /** Clear the buffer without deallocating. */
  clear() {
    this._head = 0;
    this._size = 0;
  }
}

// ─── Latency Tracker ──────────────────────────────────────────
// Tracks pipeline stage latencies with nanosecond precision using
// process.hrtime.bigint(). Maintains rolling percentile stats.

class LatencyTracker {
  constructor(name, windowSize = 1000) {
    this.name = name;
    this._samples = new CircularBuffer(windowSize);
    this._totalSamples = 0;
  }

  /** Start a measurement. Returns a token to pass to end(). */
  start() {
    return process.hrtime.bigint();
  }

  /** End a measurement. Returns latency in microseconds. */
  end(startToken) {
    const elapsed = Number(process.hrtime.bigint() - startToken) / 1000; // ns → μs
    this._samples.push(elapsed);
    this._totalSamples++;
    return elapsed;
  }

  /** Get rolling statistics. */
  getStats() {
    const samples = this._samples.toArray();
    if (samples.length === 0) return { name: this.name, count: 0 };

    const sorted = [...samples].sort((a, b) => a - b);
    const len = sorted.length;

    return {
      name: this.name,
      count: this._totalSamples,
      windowSize: len,
      min_us: Math.round(sorted[0]),
      max_us: Math.round(sorted[len - 1]),
      avg_us: Math.round(samples.reduce((a, b) => a + b, 0) / len),
      p50_us: Math.round(sorted[Math.floor(len * 0.5)]),
      p95_us: Math.round(sorted[Math.floor(len * 0.95)]),
      p99_us: Math.round(sorted[Math.floor(len * 0.99)]),
    };
  }

  /** Log stats at info level. */
  logStats() {
    const stats = this.getStats();
    if (stats.count === 0) return;
    logger.info(`⏱ ${stats.name}: avg=${stats.avg_us}μs p50=${stats.p50_us}μs p95=${stats.p95_us}μs p99=${stats.p99_us}μs (${stats.count} samples)`);
  }
}

// ─── Object Pool ──────────────────────────────────────────────
// Pre-allocates objects to avoid GC pauses during hot paths.
// Used for candle objects, indicator snapshots, etc.

class ObjectPool {
  /**
   * @param {Function} factory - Creates a new object instance
   * @param {Function} reset   - Resets an object for reuse
   * @param {number} initialSize - Pre-allocate this many objects
   */
  constructor(factory, reset, initialSize = 100) {
    this._factory = factory;
    this._reset = reset;
    this._pool = [];
    for (let i = 0; i < initialSize; i++) {
      this._pool.push(factory());
    }
    this._created = initialSize;
  }

  /** Acquire an object from the pool (or create a new one). */
  acquire() {
    if (this._pool.length > 0) {
      return this._pool.pop();
    }
    this._created++;
    return this._factory();
  }

  /** Release an object back to the pool. */
  release(obj) {
    this._reset(obj);
    this._pool.push(obj);
  }

  get available() { return this._pool.length; }
  get totalCreated() { return this._created; }
}

// ─── HTTP Connection Pool ─────────────────────────────────────
// Reusable keep-alive HTTP agents to eliminate TCP/TLS handshake
// overhead on every API call. Critical for HFT latency.

const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 50,
  maxFreeSockets: 10,
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 50,
  maxFreeSockets: 10,
});

/**
 * Get a pre-configured axios defaults object with keep-alive agents.
 * Usage: axios.get(url, { ...getKeepAliveConfig(), timeout: 3000 })
 */
function getKeepAliveConfig() {
  return {
    httpAgent,
    httpsAgent,
    timeout: 3000, // Aggressive 3s timeout for HFT
  };
}

// ─── Fast JSON Parser ─────────────────────────────────────────
// Avoids JSON.parse overhead for known WebSocket message formats
// by extracting only the fields we need via string scanning.

/**
 * Fast-parse a Binance kline WebSocket message.
 * ~3x faster than JSON.parse for this specific format.
 *
 * @param {Buffer|string} raw - Raw WebSocket message
 * @returns {Object|null} Parsed candle or null on failure
 */
function fastParseBinanceKline(raw) {
  try {
    const str = typeof raw === 'string' ? raw : raw.toString();

    // Quick reject: must contain kline marker
    if (str.indexOf('"k"') === -1) return null;

    // Extract kline object substring
    const kStart = str.indexOf('"k":{') + 4;
    const kEnd = str.indexOf('}', str.indexOf('"x":', kStart)) + 1;
    const kStr = str.substring(kStart, kEnd);

    // Extract numeric values directly (faster than full JSON parse)
    const t = extractNumber(kStr, '"t":');
    const o = extractFloat(kStr, '"o":"');
    const h = extractFloat(kStr, '"h":"');
    const l = extractFloat(kStr, '"l":"');
    const c = extractFloat(kStr, '"c":"');
    const v = extractFloat(kStr, '"v":"');
    const x = kStr.indexOf('"x":true') !== -1;

    if (t === null || o === null) return null; // Fallback signal

    return { timestamp: t, open: o, high: h, low: l, close: c, volume: v, isClosed: x, source: 'binance' };
  } catch {
    return null; // Caller should fallback to JSON.parse
  }
}

function extractNumber(str, key) {
  const idx = str.indexOf(key);
  if (idx === -1) return null;
  const start = idx + key.length;
  let end = start;
  while (end < str.length && str[end] >= '0' && str[end] <= '9') end++;
  return parseInt(str.substring(start, end), 10);
}

function extractFloat(str, key) {
  const idx = str.indexOf(key);
  if (idx === -1) return null;
  const start = idx + key.length;
  const end = str.indexOf('"', start);
  return parseFloat(str.substring(start, end));
}

module.exports = {
  CircularBuffer,
  LatencyTracker,
  ObjectPool,
  httpAgent,
  httpsAgent,
  getKeepAliveConfig,
  fastParseBinanceKline,
};
