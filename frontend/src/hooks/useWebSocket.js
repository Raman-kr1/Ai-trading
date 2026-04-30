import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore.js';
import { api } from '../services/api.js';

/**
 * Subscribe to the backend WebSocket for live updates.
 * Falls back to REST polling when the socket cannot connect.
 */
export function useWebSocket() {
  const setWsState = useStore((s) => s.setWsState);
  const pushLivePrice = useStore((s) => s.pushLivePrice);
  const applyAIDecision = useStore((s) => s.applyAIDecision);
  const prependTrade = useStore((s) => s.prependTrade);
  const prependLog = useStore((s) => s.prependLog);
  const applyMarketData = useStore((s) => s.applyMarketData);
  const applyStatus = useStore((s) => s.applyStatus);
  const pushToast = useStore((s) => s.pushToast);

  const wsRef = useRef(null);
  const retryRef = useRef(0);
  const fallbackRef = useRef(null);
  const closedByUs = useRef(false);

  useEffect(() => {
    closedByUs.current = false;

    function startFallback() {
      if (fallbackRef.current) return;
      useStore.getState().setWsState('fallback-polling');
      const tick = async () => {
        try {
          const symbol = useStore.getState().symbol;
          const [md, ai, status] = await Promise.all([
            api.marketData({ symbol, timeframe: useStore.getState().timeframe, limit: 100 }),
            api.aiDecision({ symbol }).catch(() => null),
            api.status().catch(() => null),
          ]);
          applyMarketData(md);
          if (ai) applyAIDecision(ai);
          if (status) applyStatus(status);
        } catch {
          /* ignore until next tick */
        }
      };
      tick();
      fallbackRef.current = setInterval(tick, 5000);
    }

    function stopFallback() {
      if (fallbackRef.current) {
        clearInterval(fallbackRef.current);
        fallbackRef.current = null;
      }
    }

    function connect() {
      try {
        const customUrl = import.meta.env.VITE_WS_URL;
        const url = customUrl ||
          `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;

        setWsState('connecting');
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          retryRef.current = 0;
          stopFallback();
          setWsState('connected');
          ws.send(JSON.stringify({ action: 'subscribe', channels: ['price', 'candle', 'decision', 'trade', 'trade:closed', 'log', 'status'] }));
        };

        ws.onmessage = (evt) => {
          let frame;
          try { frame = JSON.parse(evt.data); } catch { return; }
          const { channel, data } = frame || {};
          if (!channel) return;

          switch (channel) {
            case 'price':
              pushLivePrice({ price: data.price, timestamp: data.timestamp });
              break;
            case 'decision':
              applyAIDecision({
                decision: data.decision,
                confidence: data.confidence,
                entryPrice: data.entryPrice,
                stopLoss: data.stopLoss,
                targetPrice: data.targetPrice,
                reasoning: data.reasoning,
                indicators: data.indicators,
                symbol: data.symbol,
                live: true,
                timestamp: data._ts,
              });
              break;
            case 'trade':
              prependTrade(data);
              pushToast({
                type: data.side === 'BUY' ? 'success' : 'warning',
                title: `Trade executed: ${data.side} ${data.symbol}`,
                message: `Qty ${data.quantity} @ ${data.entryPrice}`,
              });
              break;
            case 'trade:closed':
              prependTrade(data);
              pushToast({
                type: data.pnl >= 0 ? 'success' : 'error',
                title: `Trade closed: ${data.symbol}`,
                message: `PnL ${data.pnl?.toFixed?.(2) ?? data.pnl}`,
              });
              break;
            case 'log':
              prependLog({
                level: data.level,
                message: data.message,
                meta: data.meta,
                timestamp: data.timestamp,
              });
              break;
            case 'status':
              applyStatus(data);
              break;
            default:
              break;
          }
        };

        ws.onclose = () => {
          if (closedByUs.current) return;
          setWsState('disconnected');
          retryRef.current += 1;
          // Exponential backoff capped at 10s. After 3 failed tries,
          // start polling so the dashboard doesn't go blank.
          const delay = Math.min(1000 * 2 ** retryRef.current, 10000);
          if (retryRef.current >= 3) startFallback();
          setTimeout(connect, delay);
        };

        ws.onerror = () => {
          // closes will follow; nothing to do here.
        };
      } catch {
        startFallback();
      }
    }

    connect();

    return () => {
      closedByUs.current = true;
      stopFallback();
      try { wsRef.current?.close(); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
