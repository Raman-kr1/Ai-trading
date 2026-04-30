import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore.js';
import { api } from '../services/api.js';
import { fmtCurrency, fmtDateTime, fmtPrice, decisionBg } from '../utils/format.js';
import { usePolling } from '../hooks/usePolling.js';
import Skeleton from './Skeleton.jsx';
import clsx from 'clsx';

const STATUS_FILTERS = ['ALL', 'OPEN', 'CLOSED', 'REJECTED'];

export default function TradeHistory() {
  const trades = useStore((s) => s.trades);
  const stats = useStore((s) => s.tradeStats);
  const pagination = useStore((s) => s.tradePagination);
  const applyTrades = useStore((s) => s.applyTrades);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const fetchTrades = async () => {
    setLoading(true);
    try {
      const params = { page, limit: 10 };
      if (search) params.search = search;
      if (status !== 'ALL') params.status = status;
      const data = await api.trades(params);
      applyTrades(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchTrades(); /* eslint-disable-next-line */ }, [page, status, search]);
  usePolling(() => fetchTrades(), 10000, [page, status, search]);

  return (
    <div className="panel">
      <div className="px-5 pt-5 pb-3 flex flex-wrap items-center gap-3 justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400">Trade History</div>
          <div className="flex items-center gap-3 mt-1 text-sm">
            <span className={stats.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              PnL: {fmtCurrency(stats.totalPnl)}
            </span>
            <span className="text-slate-400">W: <span className="text-emerald-400">{stats.winners}</span></span>
            <span className="text-slate-400">L: <span className="text-rose-400">{stats.losers}</span></span>
            <span className="text-slate-500">Closed: {stats.closed}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => { setPage(1); setSearch(e.target.value.toUpperCase()); }}
            placeholder="Search symbol…"
            className="input w-40"
          />
          <select
            value={status}
            onChange={(e) => { setPage(1); setStatus(e.target.value); }}
            className="input"
          >
            {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-bg-raised text-slate-400 text-xs uppercase tracking-wider">
            <tr>
              <th className="table-cell text-left">Time</th>
              <th className="table-cell text-left">Symbol</th>
              <th className="table-cell text-left">Side</th>
              <th className="table-cell text-right">Entry</th>
              <th className="table-cell text-right">Exit</th>
              <th className="table-cell text-right">PnL</th>
              <th className="table-cell text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && trades.length === 0 ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-t border-bg-border">
                  <td className="table-cell" colSpan={7}><Skeleton height="h-5" /></td>
                </tr>
              ))
            ) : trades.length === 0 ? (
              <tr><td colSpan={7} className="table-cell text-center text-slate-500 py-8">No trades yet.</td></tr>
            ) : trades.map((t) => (
              <tr key={t.tradeId || t._id} className="border-t border-bg-border hover:bg-bg-raised/40">
                <td className="table-cell text-slate-400">{fmtDateTime(t.createdAt)}</td>
                <td className="table-cell font-semibold">{t.symbol}</td>
                <td className="table-cell">
                  <span className={clsx('badge', decisionBg(t.side))}>{t.side}</span>
                </td>
                <td className="table-cell text-right font-mono">{fmtPrice(t.entryPrice)}</td>
                <td className="table-cell text-right font-mono">{t.exitPrice ? fmtPrice(t.exitPrice) : '—'}</td>
                <td className={clsx('table-cell text-right font-mono', (t.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                  {t.pnl ? fmtCurrency(t.pnl) : '—'}
                </td>
                <td className="table-cell">
                  <span className={clsx(
                    'badge',
                    t.status === 'OPEN'     && 'bg-sky-500/15 text-sky-400 border border-sky-500/30',
                    t.status === 'CLOSED'   && 'bg-slate-500/15 text-slate-300 border border-slate-500/30',
                    t.status === 'REJECTED' && 'bg-rose-500/15 text-rose-400 border border-rose-500/30',
                    t.status === 'PENDING'  && 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
                  )}>{t.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-3 flex items-center justify-between text-xs text-slate-400 border-t border-bg-border">
        <span>{pagination.total || 0} trades</span>
        <div className="flex items-center gap-2">
          <button className="btn-ghost py-1 px-2 text-xs" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
          <span>Page {pagination.page || 1} / {pagination.pages || 1}</span>
          <button className="btn-ghost py-1 px-2 text-xs" disabled={page >= (pagination.pages || 1)} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      </div>
    </div>
  );
}
