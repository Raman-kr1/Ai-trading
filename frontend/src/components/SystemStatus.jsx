import { useEffect } from 'react';
import { useStore } from '../store/useStore.js';
import { api } from '../services/api.js';
import { usePolling } from '../hooks/usePolling.js';
import Skeleton from './Skeleton.jsx';
import clsx from 'clsx';

const TONE = {
  connected:  'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  configured: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  ready:      'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  degraded:   'bg-amber-500/15 text-amber-400 border-amber-500/30',
  connecting: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  unknown:    'bg-slate-500/15 text-slate-400 border-slate-500/30',
  disconnected: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  error:      'bg-rose-500/15 text-rose-400 border-rose-500/30',
  'missing-key': 'bg-rose-500/15 text-rose-400 border-rose-500/30',
};

function Pill({ label, value }) {
  const cls = TONE[value] || 'bg-slate-700/40 text-slate-300 border-slate-600';
  return (
    <div className="flex items-center justify-between px-3 py-2 bg-bg-raised rounded-md">
      <span className="text-xs uppercase tracking-wider text-slate-400">{label}</span>
      <span className={clsx('badge border', cls)}>{value}</span>
    </div>
  );
}

export default function SystemStatus() {
  const status = useStore((s) => s.systemStatus);
  const applyStatus = useStore((s) => s.applyStatus);

  const fetchStatus = async () => {
    try {
      const s = await api.status();
      applyStatus(s);
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchStatus(); /* eslint-disable-next-line */ }, []);
  usePolling(() => fetchStatus(), 10000, []);

  if (!status) {
    return (
      <div className="panel-padded">
        <div className="text-xs uppercase tracking-wider text-slate-400 mb-3">System Status</div>
        <Skeleton height="h-32" />
      </div>
    );
  }

  return (
    <div className="panel-padded">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-wider text-slate-400">System Status</div>
        <span className={clsx(
          'badge border',
          status.tradingMode === 'live' ? 'bg-rose-500/15 text-rose-400 border-rose-500/30' : 'bg-sky-500/15 text-sky-400 border-sky-500/30'
        )}>
          {status.tradingMode?.toUpperCase()}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <Pill label="MongoDB"  value={status.services?.mongo} />
        <Pill label="Redis"    value={status.services?.redis} />
        <Pill label="Binance"  value={status.services?.binance} />
        <Pill label="Claude"   value={status.services?.claude} />
      </div>

      <div className="mt-3 text-xs text-slate-500 flex justify-between">
        <span>Env: {status.env}</span>
        <span>Up: {Math.floor((status.uptimeSeconds || 0) / 60)}m</span>
      </div>
    </div>
  );
}
