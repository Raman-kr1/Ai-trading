/**
 * Log Model (Mongoose)
 * ---------------------
 * Persists application logs to MongoDB so the dashboard can read them
 * via the /api/logs endpoint without tailing log files.
 *
 * Logs are capped/auto-pruned via a TTL index so the collection cannot
 * grow unbounded.
 */

const mongoose = require('mongoose');

const logSchema = new mongoose.Schema(
  {
    level: {
      type: String,
      enum: ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'],
      required: true,
      index: true,
    },
    message: { type: String, required: true },
    service: { type: String, default: 'ai-trading' },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    timestamp: { type: Date, default: Date.now, index: true },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    },
  },
  { timestamps: false }
);

// Auto-delete after expiresAt elapses
logSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
logSchema.index({ timestamp: -1, level: 1 });

module.exports = mongoose.model('Log', logSchema);
