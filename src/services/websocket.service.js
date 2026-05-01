/**
 * Frontend WebSocket Server
 * ==========================
 * Streams real-time updates to the dashboard:
 *   - BTCUSDT live price (sourced from Binance WS, fanned out)
 *   - AI decisions as they are produced
 *   - Trade executions / closures
 *   - Logs (live tail)
 *   - System status heartbeats
 *
 * Wire format (JSON, one frame per event):
 *   { channel: 'price' | 'decision' | 'trade' | 'trade:closed' | 'log' | 'status', data: <payload> }
 *
 * Clients can also send `{ action: 'subscribe', channels: ['price', 'log'] }`
 * to filter the firehose. Default subscription = all channels.
 */

const WebSocket = require('ws');
const { bus } = require('../utils/eventBus');
const marketDataService = require('./marketData.service');
const logger = require('../utils/logger');

const ALL_CHANNELS = ['price', 'candle', 'decision', 'trade', 'trade:closed', 'position:exit', 'killSwitch', 'log', 'status'];

let wss = null;
const priceStreams = new Map(); // symbol -> ws instance to Binance

function broadcast(channel, data) {
  if (!wss) return;
  const frame = JSON.stringify({ channel, data, timestamp: Date.now() });
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    if (client._subscriptions && !client._subscriptions.has(channel)) continue;
    try {
      client.send(frame);
    } catch (err) {
      logger.warn('WS send failed:', { error: err.message });
    }
  }
}

function ensureBinancePriceStream(symbol = 'BTCUSDT') {
  if (priceStreams.has(symbol)) return;
  const ws = marketDataService.subscribeBinanceStream(symbol, '1m', (candle) => {
    bus.emit('price', { symbol, price: candle.close, candle, timestamp: candle.timestamp });
    if (candle.isClosed) {
      bus.emit('candle', { symbol, interval: '1m', candle });
    }
  });
  priceStreams.set(symbol, ws);
  logger.info(`📡 Streaming ${symbol} prices to dashboard via WebSocket fan-out`);
}

function attach(httpServer, { defaultSymbol = 'BTCUSDT' } = {}) {
  wss = new WebSocket.Server({ server: httpServer, path: '/ws' });

  wss.on('connection', (client, req) => {
    client._subscriptions = new Set(ALL_CHANNELS);
    logger.info('WS client connected', { ip: req.socket.remoteAddress });

    client.send(
      JSON.stringify({
        channel: 'system',
        data: { event: 'connected', channels: ALL_CHANNELS },
        timestamp: Date.now(),
      })
    );

    client.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.action === 'subscribe' && Array.isArray(msg.channels)) {
          client._subscriptions = new Set(msg.channels.filter((c) => ALL_CHANNELS.includes(c)));
        } else if (msg.action === 'unsubscribe' && Array.isArray(msg.channels)) {
          for (const c of msg.channels) client._subscriptions.delete(c);
        } else if (msg.action === 'ping') {
          client.send(JSON.stringify({ channel: 'pong', timestamp: Date.now() }));
        }
      } catch (err) {
        logger.warn('WS bad message:', { error: err.message });
      }
    });

    client.on('close', () => logger.info('WS client disconnected'));
    client.on('error', (err) => logger.warn('WS client error:', { error: err.message }));
  });

  // Bus → fan-out
  for (const channel of ALL_CHANNELS) {
    bus.on(channel, (payload) => broadcast(channel, payload));
  }

  // Periodic heartbeat
  setInterval(() => {
    broadcast('heartbeat', { uptime: process.uptime() });
  }, 15000).unref();

  // Start the live price feed for the default symbol so dashboards
  // get a price tick even if no trading job is running.
  try {
    ensureBinancePriceStream(defaultSymbol);
  } catch (err) {
    logger.warn('Failed to start price stream:', { error: err.message });
  }

  logger.info('🛰  WebSocket server attached at /ws');
  return wss;
}

function getServer() {
  return wss;
}

module.exports = { attach, broadcast, ensureBinancePriceStream, getServer };
