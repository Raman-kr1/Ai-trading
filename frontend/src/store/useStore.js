import { create } from 'zustand';

const MAX_PRICE_POINTS = 240;
const MAX_LOGS = 200;

export const useStore = create((set, get) => ({
  // ── Market data ──────────────────────────────────────────────
  symbol: 'BTCUSDT',
  timeframe: '1m',
  price: null,
  prevPrice: null,
  priceFlash: null, // 'up' | 'down' | null
  change: 0,
  changePercent: 0,
  candles: [],
  livePoints: [], // recent { time, price } for the chart's live tail

  // ── AI ───────────────────────────────────────────────────────
  aiDecision: null,
  decisionHistory: [],

  // ── Trades ───────────────────────────────────────────────────
  trades: [],
  tradeStats: { totalPnl: 0, winners: 0, losers: 0, closed: 0 },
  tradePagination: { page: 1, limit: 20, total: 0, pages: 0 },

  // ── Logs ─────────────────────────────────────────────────────
  logs: [],

  // ── System ───────────────────────────────────────────────────
  systemStatus: null,
  wsState: 'disconnected', // 'connected' | 'connecting' | 'disconnected' | 'fallback-polling'
  lastUpdated: null,

  // ── Settings ─────────────────────────────────────────────────
  autoTrading: true,
  toasts: [],

  // ── Setters ──────────────────────────────────────────────────
  setSymbol: (s) => set({ symbol: s }),
  setTimeframe: (t) => set({ timeframe: t }),
  setAutoTrading: (v) => set({ autoTrading: v }),
  setWsState: (s) => set({ wsState: s }),

  applyMarketData: (d) => {
    if (!d) return;
    const { price: prev } = get();
    const flash = prev !== null && d.price !== null
      ? (d.price > prev ? 'up' : d.price < prev ? 'down' : null)
      : null;

    set({
      price: d.price,
      prevPrice: prev,
      priceFlash: flash,
      change: d.change ?? 0,
      changePercent: d.changePercent ?? 0,
      candles: Array.isArray(d.candles) ? d.candles : get().candles,
      lastUpdated: Date.now(),
    });

    // refresh live tail from candles when we get a fresh REST snapshot
    if (Array.isArray(d.candles) && d.candles.length) {
      const tail = d.candles.slice(-MAX_PRICE_POINTS).map((c) => ({
        time: c.timestamp,
        price: c.close,
      }));
      set({ livePoints: tail });
    }
  },

  pushLivePrice: ({ price, timestamp }) => {
    if (price == null) return;
    const prev = get().price;
    const flash = prev !== null ? (price > prev ? 'up' : price < prev ? 'down' : null) : null;
    const next = [...get().livePoints, { time: timestamp || Date.now(), price }].slice(-MAX_PRICE_POINTS);
    set({
      price,
      prevPrice: prev,
      priceFlash: flash,
      livePoints: next,
      lastUpdated: Date.now(),
    });
  },

  applyAIDecision: (d) => {
    if (!d) return;
    set({
      aiDecision: d,
      decisionHistory: [d, ...get().decisionHistory].slice(0, 50),
      lastUpdated: Date.now(),
    });
  },

  applyTrades: (payload) => {
    if (!payload) return;
    set({
      trades: payload.trades || [],
      tradeStats: payload.stats || get().tradeStats,
      tradePagination: {
        page: payload.page,
        limit: payload.limit,
        total: payload.total,
        pages: payload.pages,
      },
    });
  },

  prependTrade: (trade) => {
    if (!trade) return;
    const exists = get().trades.find((t) => t.tradeId === trade.tradeId);
    const trades = exists
      ? get().trades.map((t) => (t.tradeId === trade.tradeId ? { ...t, ...trade } : t))
      : [trade, ...get().trades].slice(0, get().tradePagination.limit || 20);
    set({ trades });
  },

  applyLogs: (items) => {
    if (!Array.isArray(items)) return;
    set({ logs: items.slice(0, MAX_LOGS) });
  },
  prependLog: (log) => {
    if (!log) return;
    set({ logs: [log, ...get().logs].slice(0, MAX_LOGS) });
  },

  applyStatus: (s) => set({ systemStatus: s }),

  pushToast: (toast) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const t = { id, type: 'info', timeout: 4000, ...toast };
    set({ toasts: [...get().toasts, t] });
    setTimeout(() => {
      set({ toasts: get().toasts.filter((x) => x.id !== id) });
    }, t.timeout);
    return id;
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
}));
