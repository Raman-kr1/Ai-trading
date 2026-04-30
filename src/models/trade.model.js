/**
 * Trade Model (Mongoose)
 * -----------------------
 * Stores executed trades with full context: entry, exit, PnL,
 * the AI decision that triggered it, and risk validation results.
 */

const mongoose = require('mongoose');

const tradeSchema = new mongoose.Schema(
  {
    tradeId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    symbol: {
      type: String,
      required: true,
      index: true,
    },
    exchange: {
      type: String,
      enum: ['binance', 'zerodha', 'paper'],
      required: true,
    },
    side: {
      type: String,
      enum: ['BUY', 'SELL'],
      required: true,
    },
    type: {
      type: String,
      enum: ['MARKET', 'LIMIT', 'STOP_LOSS'],
      default: 'MARKET',
    },
    quantity: {
      type: Number,
      required: true,
    },
    entryPrice: {
      type: Number,
      required: true,
    },
    exitPrice: {
      type: Number,
      default: null,
    },
    stopLoss: {
      type: Number,
      required: true,
    },
    targetPrice: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'OPEN', 'FILLED', 'CLOSED', 'CANCELLED', 'REJECTED'],
      default: 'PENDING',
      index: true,
    },
    pnl: {
      type: Number,
      default: 0,
    },
    pnlPercent: {
      type: Number,
      default: 0,
    },
    fees: {
      type: Number,
      default: 0,
    },
    // Reference to the AI decision that triggered this trade
    aiDecisionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Decision',
    },
    // Risk validation snapshot
    riskCheck: {
      passed: Boolean,
      riskRewardRatio: Number,
      confidence: Number,
      dailyLossCheck: Boolean,
      positionSizeCheck: Boolean,
      reasons: [String],
    },
    // Exchange-specific order response
    exchangeOrderId: String,
    exchangeResponse: mongoose.Schema.Types.Mixed,

    // Metadata
    timeframe: String,
    tradingMode: {
      type: String,
      enum: ['paper', 'live'],
      default: 'paper',
    },
    notes: String,
    closedAt: Date,
  },
  {
    timestamps: true, // adds createdAt, updatedAt
  }
);

// Compound index for querying trades by date range and symbol
tradeSchema.index({ symbol: 1, createdAt: -1 });
tradeSchema.index({ status: 1, createdAt: -1 });

// Virtual: duration of trade in minutes
tradeSchema.virtual('durationMinutes').get(function () {
  if (!this.closedAt) return null;
  return Math.round((this.closedAt - this.createdAt) / 60000);
});

// Ensure virtuals are included in JSON output
tradeSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Trade', tradeSchema);
