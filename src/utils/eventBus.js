/**
 * Process-wide Event Bus
 * -----------------------
 * Decouples event producers (worker, execution, AI service, logger)
 * from consumers (WebSocket server). Anything that wants to push
 * real-time updates to the frontend emits here.
 *
 * Channels:
 *   price        — { symbol, price, timestamp }
 *   candle       — { symbol, interval, candle }
 *   decision     — full Decision document
 *   trade        — full Trade document
 *   trade:closed — full closed Trade document
 *   log          — { level, message, meta, timestamp }
 *   status       — system status payload
 */

const { EventEmitter } = require('events');

class TradingEventBus extends EventEmitter {}

const bus = new TradingEventBus();
// Worker, logger, websocket server, controllers all attach.
// Bump the cap so we never log a memory-leak warning under high load.
bus.setMaxListeners(50);

/** Convenience helper used by emitters to time-stamp every event. */
function emit(channel, payload = {}) {
  bus.emit(channel, { ...payload, _channel: channel, _ts: Date.now() });
}

module.exports = { bus, emit };
