/**
 * Watchlist Configuration
 * ========================
 * Single source of truth for every asset the system trades. Each entry
 * carries the metadata both the scanner and the risk engine need:
 *
 *   id          stable internal key (also used as cache namespace)
 *   symbol      exchange-native symbol (BTCUSDT, RELIANCE)
 *   exchange    'binance' | 'zerodha'
 *   assetClass  'crypto' | 'equity'
 *   timeframe   default candle interval for the scanner
 *   instrumentToken  Zerodha numeric token (only for equity)
 *   minNotional  minimum order value the exchange accepts
 *   priceDecimals / qtyDecimals  rounding precision
 *   tradingHours  optional `{ open, close, tz }` for equity
 *
 * Override the active set via the WATCHLIST env var (comma-separated
 * ids). If unset, every entry below is active.
 */

'use strict';

const ALL = [
  // ── Crypto (Binance) ─────────────────────────────────────────
  {
    id: 'BTCUSDT',
    symbol: 'BTCUSDT',
    exchange: 'binance',
    assetClass: 'crypto',
    timeframe: '1m',
    minNotional: 10,
    priceDecimals: 2,
    qtyDecimals: 5,
  },
  {
    id: 'ETHUSDT',
    symbol: 'ETHUSDT',
    exchange: 'binance',
    assetClass: 'crypto',
    timeframe: '1m',
    minNotional: 10,
    priceDecimals: 2,
    qtyDecimals: 4,
  },
  {
    id: 'BNBUSDT',
    symbol: 'BNBUSDT',
    exchange: 'binance',
    assetClass: 'crypto',
    timeframe: '1m',
    minNotional: 10,
    priceDecimals: 2,
    qtyDecimals: 3,
  },

  // ── Indian Equities (Zerodha) ────────────────────────────────
  // instrumentToken values are stable Kite tokens for NSE.
  {
    id: 'RELIANCE',
    symbol: 'RELIANCE',
    exchange: 'zerodha',
    assetClass: 'equity',
    timeframe: '5m',
    instrumentToken: 738561,
    minNotional: 1000,
    priceDecimals: 2,
    qtyDecimals: 0,
    tradingHours: { open: '09:15', close: '15:30', tz: 'Asia/Kolkata' },
  },
  {
    id: 'TCS',
    symbol: 'TCS',
    exchange: 'zerodha',
    assetClass: 'equity',
    timeframe: '5m',
    instrumentToken: 2953217,
    minNotional: 1000,
    priceDecimals: 2,
    qtyDecimals: 0,
    tradingHours: { open: '09:15', close: '15:30', tz: 'Asia/Kolkata' },
  },
  {
    id: 'INFY',
    symbol: 'INFY',
    exchange: 'zerodha',
    assetClass: 'equity',
    timeframe: '5m',
    instrumentToken: 408065,
    minNotional: 1000,
    priceDecimals: 2,
    qtyDecimals: 0,
    tradingHours: { open: '09:15', close: '15:30', tz: 'Asia/Kolkata' },
  },
];

const BY_ID = new Map(ALL.map((a) => [a.id, a]));

function getActive() {
  const filter = (process.env.WATCHLIST || '').trim();
  if (!filter) return ALL;
  const ids = new Set(filter.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));
  return ALL.filter((a) => ids.has(a.id));
}

function getBySymbol(symbol) {
  return BY_ID.get((symbol || '').toUpperCase()) || null;
}

/**
 * Is the asset tradable right now? Crypto is 24/7. Equities respect
 * `tradingHours` in their declared tz.
 */
function isMarketOpen(asset, now = new Date()) {
  if (asset.assetClass === 'crypto') return true;
  if (!asset.tradingHours) return true;

  const tz = asset.tradingHours.tz || 'Asia/Kolkata';
  // Format current time in the asset's tz as HH:mm.
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const hhmm = fmt.format(now); // e.g., "10:32"
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, weekday: 'short',
  }).format(now);
  if (day === 'Sat' || day === 'Sun') return false;
  return hhmm >= asset.tradingHours.open && hhmm <= asset.tradingHours.close;
}

module.exports = {
  ALL,
  getActive,
  getBySymbol,
  isMarketOpen,
};
