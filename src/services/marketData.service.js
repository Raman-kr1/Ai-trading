/**
 * Market Data Service
 * ====================
 * Fetches real-time price data from Binance (crypto) and Zerodha (Indian stocks).
 * Normalizes all data into a common OHLCV format and caches it in Redis.
 *
 * Supports:
 *   - REST API polling (klines/candles)
 *   - WebSocket streaming (Binance)
 *   - Multi-timeframe data (1m, 5m, 15m, 1h, 1d)
 *   - Redis caching with configurable TTL
 */

const axios = require('axios');
const WebSocket = require('ws');
const config = require('../config');
const { cache } = require('../config/redis');
const { normalizeCandle, createHmacSignature, retryWithBackoff } = require('../utils/helpers');
const logger = require('../utils/logger');

// ─── Binance REST API ──────────────────────────────────────────

/**
 * Fetch kline (candlestick) data from Binance.
 *
 * @param {string} symbol  - Trading pair, e.g. 'BTCUSDT'
 * @param {string} interval - Timeframe: '1m', '5m', '15m', '1h', '4h', '1d'
 * @param {number} limit   - Number of candles (max 1000)
 * @returns {Array} Normalized candle array
 */
async function fetchBinanceKlines(symbol, interval = '1m', limit = 100) {
  const cacheKey = `binance:klines:${symbol}:${interval}`;

  // Check cache first
  const cached = await cache.get(cacheKey);
  if (cached) {
    logger.debug(`Cache hit: ${cacheKey}`);
    return cached;
  }

  try {
    const response = await retryWithBackoff(async () => {
      return axios.get(`${config.binance.baseUrl}/api/v3/klines`, {
        params: { symbol, interval, limit },
        timeout: 10000,
      });
    }, 3);

    const candles = response.data.map((raw) => normalizeCandle(raw, 'binance'));

    // Cache with TTL
    await cache.set(cacheKey, candles, config.scheduler.marketDataCacheTtl);

    logger.info(`Fetched ${candles.length} candles from Binance: ${symbol} [${interval}]`);
    return candles;
  } catch (error) {
    logger.error(`Binance klines fetch failed: ${symbol}`, { error: error.message });
    throw error;
  }
}

/**
 * Fetch current ticker price from Binance.
 */
async function fetchBinancePrice(symbol) {
  const cacheKey = `binance:price:${symbol}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  try {
    const response = await axios.get(`${config.binance.baseUrl}/api/v3/ticker/price`, {
      params: { symbol },
      timeout: 5000,
    });

    const price = parseFloat(response.data.price);
    await cache.set(cacheKey, price, 5); // Short TTL for live price
    return price;
  } catch (error) {
    logger.error(`Binance price fetch failed: ${symbol}`, { error: error.message });
    throw error;
  }
}

/**
 * Fetch Binance account info (balances).
 * Requires authenticated request.
 */
async function fetchBinanceBalance() {
  try {
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = createHmacSignature(queryString, config.binance.apiSecret);

    const response = await axios.get(`${config.binance.baseUrl}/api/v3/account`, {
      params: { timestamp, signature },
      headers: { 'X-MBX-APIKEY': config.binance.apiKey },
      timeout: 10000,
    });

    // Filter to non-zero balances
    const balances = response.data.balances
      .filter((b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
      .map((b) => ({
        asset: b.asset,
        free: parseFloat(b.free),
        locked: parseFloat(b.locked),
      }));

    return balances;
  } catch (error) {
    logger.error('Binance balance fetch failed:', { error: error.message });
    throw error;
  }
}

// ─── Binance WebSocket Stream ──────────────────────────────────

/**
 * Subscribe to a real-time kline stream from Binance via WebSocket.
 * Falls back to REST polling when the WS is unavailable (e.g., testnet
 * kline streams return 404 — a known Binance testnet limitation).
 *
 * @param {string} symbol   - e.g. 'BTCUSDT'
 * @param {string} interval - e.g. '1m'
 * @param {Function} onData - Callback receiving normalized candle data
 * @returns {{ close: Function }} Handle to stop the stream/poll
 */
function subscribeBinanceStream(symbol, interval = '1m', onData) {
  let consecutiveFails = 0;
  const MAX_WS_FAILS = 3;
  let stopped = false;
  let pollTimer = null;
  let wsInstance = null;

  function startPolling() {
    if (pollTimer || stopped) return;
    logger.warn(`📊 WS unavailable for ${symbol} — switching to REST polling (5 s)`);

    const poll = async () => {
      if (stopped) return;
      try {
        const price = await fetchBinancePrice(symbol);
        const candle = {
          timestamp: Date.now(),
          open: price, high: price, low: price, close: price,
          volume: 0, isClosed: false, source: 'binance-poll',
        };
        await cache.set(`binance:live:${symbol.toUpperCase()}`, candle, 10);
        if (onData) onData(candle);
      } catch (e) {
        logger.debug(`Price poll error for ${symbol}: ${e.message}`);
      }
    };

    poll();
    pollTimer = setInterval(poll, 5000);
  }

  function tryWs() {
    if (stopped) return;
    const wsUrl = `${config.binance.wsUrl}/${symbol.toLowerCase()}@kline_${interval}`;
    const ws = new WebSocket(wsUrl);
    wsInstance = ws;

    ws.on('open', () => {
      consecutiveFails = 0;
      logger.info(`WebSocket connected: ${symbol}@kline_${interval}`);
    });

    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data);
        const kline = parsed.k;
        const candle = {
          timestamp: kline.t,
          open: parseFloat(kline.o), high: parseFloat(kline.h),
          low: parseFloat(kline.l),  close: parseFloat(kline.c),
          volume: parseFloat(kline.v), isClosed: kline.x,
          source: 'binance',
        };
        cache.set(`binance:live:${symbol.toUpperCase()}`, candle, 5);
        if (onData) onData(candle);
      } catch (error) {
        logger.error('WebSocket message parse error:', { error: error.message });
      }
    });

    ws.on('error', () => {
      consecutiveFails += 1;
    });

    ws.on('close', () => {
      if (stopped) return;
      consecutiveFails += 1;
      if (consecutiveFails >= MAX_WS_FAILS) {
        // WS stream is persistently broken (testnet kline 404).
        // Give up on reconnecting and use REST polling instead.
        startPolling();
      } else {
        const delay = Math.min(5000 * consecutiveFails, 30000);
        logger.warn(`WebSocket closed: ${symbol}@kline_${interval}. Retry in ${delay / 1000}s…`);
        setTimeout(tryWs, delay);
      }
    });
  }

  tryWs();

  return {
    close() {
      stopped = true;
      if (pollTimer) clearInterval(pollTimer);
      if (wsInstance) try { wsInstance.terminate(); } catch { /* noop */ }
    },
  };
}

// ─── Zerodha Kite API ──────────────────────────────────────────

/**
 * Fetch historical candles from Zerodha Kite.
 *
 * @param {string} instrumentToken - Zerodha instrument token
 * @param {string} interval       - 'minute', '5minute', '15minute', 'hour', 'day'
 * @param {string} from           - Start date: 'YYYY-MM-DD HH:mm:ss'
 * @param {string} to             - End date: 'YYYY-MM-DD HH:mm:ss'
 * @returns {Array} Normalized candle array
 */
async function fetchZerodhaCandles(instrumentToken, interval = 'minute', from, to) {
  const cacheKey = `zerodha:candles:${instrumentToken}:${interval}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  try {
    // Default date range: last 1 day
    const now = new Date();
    const defaultFrom = new Date(now - 24 * 60 * 60 * 1000);
    const fromDate = from || defaultFrom.toISOString().split('T')[0] + ' 09:15:00';
    const toDate = to || now.toISOString().split('T')[0] + ' 15:30:00';

    const response = await retryWithBackoff(async () => {
      return axios.get(
        `${config.zerodha.baseUrl}/instruments/historical/${instrumentToken}/${interval}`,
        {
          params: { from: fromDate, to: toDate },
          headers: {
            'X-Kite-Version': '3',
            Authorization: `token ${config.zerodha.apiKey}:${config.zerodha.accessToken}`,
          },
          timeout: 10000,
        }
      );
    }, 3);

    const candles = response.data.data.candles.map((raw) => {
      return normalizeCandle(
        {
          date: raw[0],
          open: raw[1],
          high: raw[2],
          low: raw[3],
          close: raw[4],
          volume: raw[5],
        },
        'zerodha'
      );
    });

    await cache.set(cacheKey, candles, config.scheduler.marketDataCacheTtl);
    logger.info(`Fetched ${candles.length} candles from Zerodha: ${instrumentToken} [${interval}]`);
    return candles;
  } catch (error) {
    logger.error(`Zerodha candles fetch failed: ${instrumentToken}`, { error: error.message });
    throw error;
  }
}

/**
 * Fetch current quote from Zerodha.
 */
async function fetchZerodhaQuote(tradingSymbol) {
  try {
    const response = await axios.get(`${config.zerodha.baseUrl}/quote`, {
      params: { i: `NSE:${tradingSymbol}` },
      headers: {
        'X-Kite-Version': '3',
        Authorization: `token ${config.zerodha.apiKey}:${config.zerodha.accessToken}`,
      },
      timeout: 5000,
    });

    const quote = response.data.data[`NSE:${tradingSymbol}`];
    return {
      symbol: tradingSymbol,
      lastPrice: quote.last_price,
      open: quote.ohlc.open,
      high: quote.ohlc.high,
      low: quote.ohlc.low,
      close: quote.ohlc.close,
      volume: quote.volume,
      source: 'zerodha',
    };
  } catch (error) {
    logger.error(`Zerodha quote fetch failed: ${tradingSymbol}`, { error: error.message });
    throw error;
  }
}

// ─── Multi-Timeframe Support ───────────────────────────────────

/**
 * Fetch data for multiple timeframes simultaneously.
 * Returns an object keyed by timeframe.
 *
 * @param {string} symbol     - Trading pair / instrument
 * @param {string} exchange   - 'binance' | 'zerodha'
 * @param {Array} timeframes  - e.g. ['1m', '5m', '15m', '1h']
 * @returns {Object} { '1m': [...candles], '5m': [...candles], ... }
 */
async function fetchMultiTimeframe(symbol, exchange = 'binance', timeframes = ['1m', '5m', '15m']) {
  const results = {};

  const fetches = timeframes.map(async (tf) => {
    try {
      if (exchange === 'binance') {
        results[tf] = await fetchBinanceKlines(symbol, tf, 100);
      } else if (exchange === 'zerodha') {
        // Map standard timeframes to Zerodha format
        const zerodhaMap = { '1m': 'minute', '5m': '5minute', '15m': '15minute', '1h': 'hour', '1d': 'day' };
        results[tf] = await fetchZerodhaCandles(symbol, zerodhaMap[tf] || 'minute');
      }
    } catch (error) {
      logger.error(`Multi-timeframe fetch failed for ${tf}:`, { error: error.message });
      results[tf] = [];
    }
  });

  await Promise.all(fetches);
  return results;
}

module.exports = {
  // Binance
  fetchBinanceKlines,
  fetchBinancePrice,
  fetchBinanceBalance,
  subscribeBinanceStream,
  // Zerodha
  fetchZerodhaCandles,
  fetchZerodhaQuote,
  // Multi-timeframe
  fetchMultiTimeframe,
};
