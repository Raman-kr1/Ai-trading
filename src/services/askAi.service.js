/**
 * Ask-AI
 * =======
 * Free-form Q&A about a specific symbol. Pulls live indicators +
 * historical context, hands them to Claude alongside the user's
 * question, and returns plain prose.
 *
 * Deliberately NOT the trade-decision endpoint — this one is
 * conversational and read-only. No JSON contract, no risk gating, no
 * persisted Decision record.
 */

'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');
const watchlist = require('../config/watchlist');
const marketDataService = require('./marketData.service');
const indicatorService = require('./indicator.service');
const contextMemory = require('./contextMemory.service');
const logger = require('../utils/logger');

const anthropic = new Anthropic({ apiKey: config.claude.apiKey });

const SYSTEM_PROMPT = `You are a senior quantitative trading analyst answering questions for the operator of an automated trading system.
Ground every answer in the live indicators and historical context provided. Be concise (≤6 short paragraphs or bullets).
If the data is insufficient to answer, say so plainly. Never recommend a specific trade — the trade decision is made by a separate engine. Discuss setups, risks, and reasoning instead.`;

async function fetchSnapshot(asset) {
  if (asset.exchange === 'binance') {
    const candles = await marketDataService.fetchBinanceKlines(asset.symbol, asset.timeframe || '1m', 100);
    return { candles };
  }
  const tfMap = { '1m': 'minute', '5m': '5minute', '15m': '15minute', '1h': 'hour', '1d': 'day' };
  const candles = await marketDataService.fetchZerodhaCandles(
    asset.instrumentToken, tfMap[asset.timeframe] || '5minute',
  );
  return { candles };
}

function buildUserMessage(symbol, question, indicators, ctxText) {
  return `User question about ${symbol}:
"""
${question}
"""

LIVE INDICATORS:
- Price: ${indicators.currentPrice}
- RSI(14): ${indicators.rsi}
- MACD: line=${indicators.macd?.line}, signal=${indicators.macd?.signal}, hist=${indicators.macd?.histogram}
- EMA(20)/EMA(50): ${indicators.ema20} / ${indicators.ema50}
- VWAP: ${indicators.vwap}
- Signals: RSI=${indicators.signals?.rsi}, MACD=${indicators.signals?.macd}, EMA-cross=${indicators.signals?.emaCrossover}, VWAP=${indicators.signals?.vwap}

${ctxText}

Answer the user's question using this data. Keep it grounded and specific.`;
}

async function answerQuestion({ symbol, question }) {
  if (!symbol || !question) {
    throw new Error('symbol and question are required');
  }
  const asset = watchlist.getBySymbol(symbol);
  if (!asset) {
    throw new Error(`Unknown symbol "${symbol}". Add it to watchlist first.`);
  }

  const { candles } = await fetchSnapshot(asset);
  if (!candles || candles.length < 26) {
    throw new Error(`Insufficient market data for ${symbol}`);
  }
  const indicators = indicatorService.computeAllIndicators(candles);
  const ctx = await contextMemory.getSymbolContext(symbol).catch(() => null);
  const ctxText = ctx ? contextMemory.formatContextForPrompt(ctx) : 'HISTORICAL CONTEXT: (none available)';

  if (!config.claude.apiKey) {
    return {
      symbol,
      answer: `(mock — Claude API key not set)\n\nLive RSI ${indicators.rsi}, EMA20 ${indicators.ema20}, VWAP ${indicators.vwap}.`,
      indicators,
      contextProvided: !!ctx,
    };
  }

  const startedAt = Date.now();
  const response = await anthropic.messages.create({
    model: config.claude.model,
    max_tokens: Math.max(config.claude.maxTokens, 1024),
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserMessage(symbol, question, indicators, ctxText) }],
  });
  const latencyMs = Date.now() - startedAt;
  const answer = response.content?.[0]?.text || '';

  logger.info(`ask-ai answered ${symbol} in ${latencyMs}ms`, {
    promptTokens: response.usage?.input_tokens,
    completionTokens: response.usage?.output_tokens,
  });

  return {
    symbol,
    answer,
    indicators: {
      currentPrice: indicators.currentPrice,
      rsi: indicators.rsi,
      macd: indicators.macd,
      ema20: indicators.ema20,
      ema50: indicators.ema50,
      vwap: indicators.vwap,
      signals: indicators.signals,
    },
    contextProvided: !!ctx,
    latencyMs,
    model: config.claude.model,
  };
}

module.exports = { answerQuestion };
