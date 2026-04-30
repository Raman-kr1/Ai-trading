/**
 * Winston Logger
 * ---------------
 * Structured JSON logging with file rotation, console output,
 * MongoDB persistence (via custom transport), and live event-bus
 * forwarding so the WebSocket layer can stream logs to clients.
 *
 * All services import this single logger instance.
 */

const winston = require('winston');
const Transport = require('winston-transport');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const { emit } = require('./eventBus');

// Ensure log directory exists
const LOG_DIR = process.env.LOG_DIR || './logs';
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// ── Custom: persist to MongoDB ─────────────────────────────────
class MongoTransport extends Transport {
  constructor(opts = {}) {
    super(opts);
    this.name = 'MongoTransport';
    this.minLevel = opts.minLevel || 'info';
  }

  log(info, callback) {
    setImmediate(() => this.emit('logged', info));

    // Only write when Mongo is actually connected to avoid buffering
    // blow-ups when Mongo is down.
    if (mongoose.connection.readyState !== 1) {
      return callback();
    }

    // Resolve lazily to avoid circular require with the model file.
    const Log = require('../models/log.model');
    const { level, message, timestamp, service, ...meta } = info;

    Log.create({
      level,
      message: typeof message === 'string' ? message : JSON.stringify(message),
      service: service || process.env.APP_NAME || 'ai-trading',
      meta,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
    }).catch(() => {
      /* swallow — logging must never crash the app */
    });

    callback();
  }
}

// ── Custom: forward to in-process event bus ────────────────────
class EventBusTransport extends Transport {
  log(info, callback) {
    setImmediate(() => this.emit('logged', info));
    const { level, message, timestamp, service, ...meta } = info;
    try {
      emit('log', {
        level,
        message: typeof message === 'string' ? message : JSON.stringify(message),
        service,
        meta,
        timestamp: timestamp || new Date().toISOString(),
      });
    } catch {
      /* never crash on event emission */
    }
    callback();
  }
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: process.env.APP_NAME || 'ai-trading' },
  transports: [
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'combined.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'trades.log'),
      level: 'info',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 10,
    }),
    new MongoTransport({ level: 'info' }),
    new EventBusTransport({ level: 'info' }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} [${service}] ${level}: ${message}${metaStr}`;
        })
      ),
    })
  );
}

module.exports = logger;
