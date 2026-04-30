/**
 * Utility Helpers
 * ----------------
 * Shared utility functions used across services.
 */

const crypto = require('crypto');

/**
 * Generate a unique trade ID.
 * Format: TRD-{timestamp}-{random4}
 */
function generateTradeId() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `TRD-${timestamp}-${random}`;
}

/**
 * Sleep for a given number of milliseconds.
 * Useful for rate-limiting API calls.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Round a number to a specified number of decimal places.
 */
function roundTo(value, decimals = 2) {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

/**
 * Calculate percentage change between two values.
 */
function percentChange(oldVal, newVal) {
  if (oldVal === 0) return 0;
  return roundTo(((newVal - oldVal) / Math.abs(oldVal)) * 100, 4);
}

/**
 * Create HMAC-SHA256 signature for exchange API authentication.
 */
function createHmacSignature(queryString, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(queryString)
    .digest('hex');
}

/**
 * Normalize a candle/OHLCV object into the common format used system-wide.
 */
function normalizeCandle(raw, source) {
  switch (source) {
    case 'binance':
      return {
        timestamp: raw[0],
        open: parseFloat(raw[1]),
        high: parseFloat(raw[2]),
        low: parseFloat(raw[3]),
        close: parseFloat(raw[4]),
        volume: parseFloat(raw[5]),
        source: 'binance',
      };
    case 'zerodha':
      return {
        timestamp: new Date(raw.date).getTime(),
        open: raw.open,
        high: raw.high,
        low: raw.low,
        close: raw.close,
        volume: raw.volume,
        source: 'zerodha',
      };
    default:
      return raw;
  }
}

/**
 * Validate that an object contains all required fields.
 * Returns { valid: boolean, missing: string[] }
 */
function validateFields(obj, requiredFields) {
  const missing = requiredFields.filter(
    (field) => obj[field] === undefined || obj[field] === null
  );
  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Retry a function with exponential backoff.
 */
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      const delay = baseDelay * Math.pow(2, attempt);
      await sleep(delay);
    }
  }
}

/**
 * Format a timestamp to ISO string or human-readable format.
 */
function formatTimestamp(ts, format = 'iso') {
  const date = new Date(ts);
  if (format === 'iso') return date.toISOString();
  return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

module.exports = {
  generateTradeId,
  sleep,
  roundTo,
  percentChange,
  createHmacSignature,
  normalizeCandle,
  validateFields,
  retryWithBackoff,
  formatTimestamp,
};
