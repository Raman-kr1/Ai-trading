/**
 * Technical Indicator Engine
 * ===========================
 * Computes RSI, MACD, EMA (20/50), and VWAP from normalized candle data.
 */

const { RSI, MACD, EMA, SMA } = require('technicalindicators');
const { roundTo } = require('../utils/helpers');
const logger = require('../utils/logger');

function calculateRSI(candles, period = 14) {
  try {
    const closes = candles.map((c) => c.close);
    const vals = RSI.calculate({ values: closes, period });
    return vals.length > 0 ? roundTo(vals[vals.length - 1], 2) : null;
  } catch (e) { logger.error('RSI error:', { error: e.message }); return null; }
}

function calculateMACD(candles, fast = 12, slow = 26, sig = 9) {
  try {
    const closes = candles.map((c) => c.close);
    const vals = MACD.calculate({ values: closes, fastPeriod: fast, slowPeriod: slow, signalPeriod: sig, SimpleMAOscillator: false, SimpleMASignal: false });
    if (!vals.length) return null;
    const l = vals[vals.length - 1];
    return { line: roundTo(l.MACD, 4), signal: roundTo(l.signal, 4), histogram: roundTo(l.histogram, 4) };
  } catch (e) { logger.error('MACD error:', { error: e.message }); return null; }
}

function calculateEMA(candles, period) {
  try {
    const closes = candles.map((c) => c.close);
    const vals = EMA.calculate({ values: closes, period });
    return vals.length > 0 ? roundTo(vals[vals.length - 1], 4) : null;
  } catch (e) { logger.error(`EMA(${period}) error:`, { error: e.message }); return null; }
}

function calculateVWAP(candles) {
  try {
    if (!candles.length) return null;
    let cumTPV = 0, cumVol = 0;
    for (const c of candles) {
      const tp = (c.high + c.low + c.close) / 3;
      cumTPV += tp * c.volume;
      cumVol += c.volume;
    }
    return cumVol === 0 ? null : roundTo(cumTPV / cumVol, 4);
  } catch (e) { logger.error('VWAP error:', { error: e.message }); return null; }
}

function calculateSMA(candles, period) {
  try {
    const closes = candles.map((c) => c.close);
    const vals = SMA.calculate({ values: closes, period });
    return vals.length > 0 ? roundTo(vals[vals.length - 1], 4) : null;
  } catch (e) { logger.error(`SMA(${period}) error:`, { error: e.message }); return null; }
}

function deriveTrendSignals(ind) {
  const s = {};
  if (ind.rsi !== null) { s.rsi = ind.rsi > 70 ? 'OVERBOUGHT' : ind.rsi < 30 ? 'OVERSOLD' : 'NEUTRAL'; }
  if (ind.macd) { s.macd = (ind.macd.histogram > 0 && ind.macd.line > ind.macd.signal) ? 'BULLISH' : (ind.macd.histogram < 0) ? 'BEARISH' : 'NEUTRAL'; }
  if (ind.ema20 !== null && ind.ema50 !== null) { s.emaCrossover = ind.ema20 > ind.ema50 ? 'BULLISH' : 'BEARISH'; }
  if (ind.vwap !== null && ind.currentPrice) { s.vwap = ind.currentPrice > ind.vwap ? 'ABOVE_VWAP' : 'BELOW_VWAP'; }
  return s;
}

/** Compute all indicators from raw candle data. */
function computeAllIndicators(candles) {
  if (!candles || candles.length < 26) {
    logger.warn(`Insufficient candles: ${candles?.length || 0} (need ≥26)`);
    return null;
  }
  const cp = candles[candles.length - 1].close;
  const pp = candles[candles.length - 2]?.close;
  const ind = {
    rsi: calculateRSI(candles), macd: calculateMACD(candles),
    ema20: calculateEMA(candles, 20), ema50: calculateEMA(candles, 50),
    vwap: calculateVWAP(candles), sma20: calculateSMA(candles, 20),
    currentPrice: roundTo(cp, 4), previousPrice: roundTo(pp, 4),
    priceChange: pp ? roundTo(cp - pp, 4) : 0,
    priceChangePercent: pp ? roundTo(((cp - pp) / pp) * 100, 4) : 0,
    candleCount: candles.length, latestTimestamp: candles[candles.length - 1].timestamp,
    signals: {},
  };
  ind.signals = deriveTrendSignals(ind);
  return ind;
}

module.exports = { calculateRSI, calculateMACD, calculateEMA, calculateVWAP, calculateSMA, computeAllIndicators, deriveTrendSignals };
