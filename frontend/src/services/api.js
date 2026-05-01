/**
 * REST API client.
 * In dev, Vite proxies /api → backend. In prod, set VITE_API_BASE
 * to the absolute backend URL.
 */
import axios from 'axios';

const baseURL = import.meta.env.VITE_API_BASE || '/api';

const client = axios.create({
  baseURL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Lightweight retry-on-network-error for GET requests.
client.interceptors.response.use(
  (res) => res,
  async (err) => {
    const cfg = err.config || {};
    const isGet = (cfg.method || 'get').toLowerCase() === 'get';
    cfg.__retryCount = cfg.__retryCount || 0;
    const transient = !err.response || err.code === 'ECONNABORTED' || (err.response.status >= 500 && err.response.status < 600);
    if (isGet && transient && cfg.__retryCount < 2) {
      cfg.__retryCount += 1;
      await new Promise((r) => setTimeout(r, 400 * cfg.__retryCount));
      return client(cfg);
    }
    return Promise.reject(err);
  }
);

export const api = {
  marketData: (params = {}) => client.get('/market-data', { params }).then((r) => r.data),
  aiDecision: (params = {}) => client.get('/ai-decision', { params }).then((r) => r.data),
  trades: (params = {}) => client.get('/trades', { params }).then((r) => r.data),
  status: () => client.get('/status').then((r) => r.data),
  logs: (params = {}) => client.get('/logs', { params }).then((r) => r.data),
  pnlSeries: (params = {}) => client.get('/pnl-series', { params }).then((r) => r.data),
  positions: () => client.get('/positions').then((r) => r.data),
  execute: (body) => client.post('/execute', body).then((r) => r.data),
  closeTrade: (tradeId, body) => client.post(`/trades/${tradeId}/close`, body).then((r) => r.data),
};

export default client;
