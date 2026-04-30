/**
 * AI Decision Engine (Claude API)
 * =================================
 * Sends structured market data + indicators to Claude and receives
 * a JSON trading decision. Uses strict prompt engineering to ensure
 * deterministic, parseable output.
 */

const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');
const logger = require('../utils/logger');

// Initialize Anthropic client
const anthropic = new Anthropic({ apiKey: config.claude.apiKey });

/**
 * Build the system prompt for trading decisions.
 * This prompt constrains Claude to return ONLY valid JSON.
 */
function buildSystemPrompt() {
  return `You are an expert quantitative trading analyst. You analyze technical indicators and market data to make trading decisions.

RULES:
1. You MUST respond with ONLY a valid JSON object. No explanations, no markdown, no extra text.
2. Your decision must be one of: "BUY", "SELL", or "HOLD".
3. Confidence must be an integer between 0 and 100.
4. All prices must be realistic numbers based on the input data.
5. If data is insufficient or unclear, respond with HOLD and low confidence.

RESPONSE FORMAT (strict JSON):
{
  "decision": "BUY" | "SELL" | "HOLD",
  "entry_price": <number>,
  "stop_loss": <number>,
  "target_price": <number>,
  "confidence": <integer 0-100>,
  "reasoning": "<brief one-line reasoning>"
}`;
}

/**
 * Build the user message with market data and indicators.
 */
function buildUserPrompt(symbol, indicators, marketData, exchange) {
  return `Analyze this market data and provide a trading decision:

SYMBOL: ${symbol}
EXCHANGE: ${exchange}

CURRENT PRICE: ${indicators.currentPrice}
PRICE CHANGE: ${indicators.priceChange} (${indicators.priceChangePercent}%)

TECHNICAL INDICATORS:
- RSI(14): ${indicators.rsi}
- MACD: line=${indicators.macd?.line}, signal=${indicators.macd?.signal}, histogram=${indicators.macd?.histogram}
- EMA(20): ${indicators.ema20}
- EMA(50): ${indicators.ema50}
- VWAP: ${indicators.vwap}
- SMA(20): ${indicators.sma20}

SIGNALS:
- RSI Signal: ${indicators.signals?.rsi}
- MACD Signal: ${indicators.signals?.macd}
- EMA Crossover: ${indicators.signals?.emaCrossover}
- VWAP Position: ${indicators.signals?.vwap}

RECENT CANDLES (last 5):
${JSON.stringify(marketData.slice(-5), null, 2)}

Provide your trading decision as a JSON object.`;
}

/**
 * Get a trading decision from Claude.
 *
 * @param {string} symbol      - Trading pair/instrument
 * @param {Object} indicators  - Output from computeAllIndicators()
 * @param {Array}  marketData  - Raw normalized candle array
 * @param {string} exchange    - 'binance' | 'zerodha'
 * @returns {Object} Parsed decision object
 */
async function getTradeDecision(symbol, indicators, marketData, exchange = 'binance') {
  const startTime = Date.now();

  try {
    if (!config.claude.apiKey) {
      logger.warn('Claude API key not set — returning mock HOLD decision');
      return createMockDecision(indicators);
    }

    const response = await anthropic.messages.create({
      model: config.claude.model,
      max_tokens: config.claude.maxTokens,
      system: buildSystemPrompt(),
      messages: [
        { role: 'user', content: buildUserPrompt(symbol, indicators, marketData, exchange) },
      ],
    });

    const latencyMs = Date.now() - startTime;
    const rawText = response.content[0]?.text || '';

    // Parse Claude's JSON response
    const decision = parseDecisionResponse(rawText);

    // Attach metadata
    decision._meta = {
      model: config.claude.model,
      promptTokens: response.usage?.input_tokens,
      completionTokens: response.usage?.output_tokens,
      latencyMs,
    };

    logger.info(`AI Decision for ${symbol}: ${decision.decision} (confidence: ${decision.confidence}%)`, {
      symbol, decision: decision.decision, confidence: decision.confidence, latencyMs,
    });

    return decision;
  } catch (error) {
    logger.error('Claude API call failed:', { error: error.message, symbol });

    // Fallback to HOLD on API failure
    return {
      decision: 'HOLD', entry_price: indicators.currentPrice,
      stop_loss: 0, target_price: 0, confidence: 0,
      reasoning: `AI engine error: ${error.message}`,
      _meta: { error: true, latencyMs: Date.now() - startTime },
    };
  }
}

/**
 * Parse and validate Claude's JSON response.
 * Handles edge cases like markdown code blocks or extra text.
 */
function parseDecisionResponse(rawText) {
  let cleaned = rawText.trim();

  // Strip markdown code fences if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    const parsed = JSON.parse(cleaned);

    // Validate required fields
    const requiredFields = ['decision', 'entry_price', 'stop_loss', 'target_price', 'confidence'];
    for (const field of requiredFields) {
      if (parsed[field] === undefined) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Normalize decision to uppercase
    parsed.decision = parsed.decision.toUpperCase();

    // Validate decision value
    if (!['BUY', 'SELL', 'HOLD'].includes(parsed.decision)) {
      throw new Error(`Invalid decision: ${parsed.decision}`);
    }

    // Clamp confidence
    parsed.confidence = Math.max(0, Math.min(100, parseInt(parsed.confidence, 10)));

    return parsed;
  } catch (error) {
    logger.error('Failed to parse AI response:', { rawText: rawText.substring(0, 200), error: error.message });
    return {
      decision: 'HOLD', entry_price: 0, stop_loss: 0,
      target_price: 0, confidence: 0,
      reasoning: `Parse error: ${error.message}`,
    };
  }
}

/**
 * Create a mock decision for testing when Claude API is not available.
 */
function createMockDecision(indicators) {
  return {
    decision: 'HOLD', entry_price: indicators.currentPrice,
    stop_loss: indicators.currentPrice * 0.98,
    target_price: indicators.currentPrice * 1.04,
    confidence: 25,
    reasoning: 'Mock decision — Claude API key not configured',
    _meta: { model: 'mock', latencyMs: 0 },
  };
}

module.exports = { getTradeDecision, parseDecisionResponse, buildSystemPrompt, buildUserPrompt };
