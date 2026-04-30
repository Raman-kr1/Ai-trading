/**
 * Decision Model (Mongoose)
 * --------------------------
 * Stores every AI decision from Claude, regardless of whether
 * the trade was executed. This creates a full audit trail for
 * backtesting and performance analysis.
 */

const mongoose = require('mongoose');

const decisionSchema = new mongoose.Schema(
  {
    symbol: {
      type: String,
      required: true,
      index: true,
    },
    exchange: {
      type: String,
      enum: ['binance', 'zerodha'],
      required: true,
    },
    timeframe: {
      type: String,
      default: '1m',
    },

    // Claude's raw decision
    decision: {
      type: String,
      enum: ['BUY', 'SELL', 'HOLD'],
      required: true,
    },
    entryPrice: Number,
    stopLoss: Number,
    targetPrice: Number,
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    reasoning: String,

    // Indicators snapshot at decision time
    indicators: {
      rsi: Number,
      macd: {
        line: Number,
        signal: Number,
        histogram: Number,
      },
      ema20: Number,
      ema50: Number,
      vwap: Number,
      currentPrice: Number,
    },

    // Market data snapshot
    marketData: {
      open: Number,
      high: Number,
      low: Number,
      close: Number,
      volume: Number,
    },

    // Risk engine verdict
    riskApproved: {
      type: Boolean,
      default: false,
    },
    riskReasons: [String],

    // Whether this decision led to an actual trade
    executed: {
      type: Boolean,
      default: false,
    },
    tradeId: String,

    // Claude API metadata
    model: String,
    promptTokens: Number,
    completionTokens: Number,
    latencyMs: Number,
  },
  {
    timestamps: true,
  }
);

decisionSchema.index({ createdAt: -1 });
decisionSchema.index({ decision: 1, riskApproved: 1 });

module.exports = mongoose.model('Decision', decisionSchema);
