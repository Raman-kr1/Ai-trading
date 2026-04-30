import { useEffect, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { api } from '../services/api.js';
import { usePolling } from '../hooks/usePolling.js';
import { fmtCurrency, fmtDateTime } from '../utils/format.js';
import Skeleton from './Skeleton.jsx';

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-bg-raised border border-bg-border px-3 py-2 rounded-md text-xs shadow-xl">
      <div className="text-slate-400">{fmtDateTime(p.t)}</div>
      <div className="font-mono font-semibold text-slate-100">Cumulative {fmtCurrency(p.cumulative)}</div>
      <div className="font-mono text-slate-400">Trade PnL {fmtCurrency(p.pnl)}</div>
    </div>
  );
}

export default function PnLChart() {
  const [series, setSeries] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetch = async () => {
    try {
      const res = await api.pnlSeries({ days: 30 });
      setSeries(res.series || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetch(); }, []);
  usePolling(() => fetch(), 30000, []);

  const last = series[series.length - 1];

  return (
    <div className="panel-padded">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400">PnL (30d)</div>
          <div className={`text-xl font-mono font-bold ${(last?.cumulative || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {fmtCurrency(last?.cumulative || 0)}
          </div>
        </div>
        <span className="text-xs text-slate-500">{series.length} closed</span>
      </div>
      <div className="h-40">
        {loading && series.length === 0 ? (
          <Skeleton height="h-full" />
        ) : series.length === 0 ? (
          <div className="h-full flex items-center justify-center text-slate-500 text-sm">No closed trades yet</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="pnlFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2c47" />
              <XAxis dataKey="t" tickFormatter={(v) => new Date(v).toLocaleDateString()} stroke="#64748b" tick={{ fontSize: 10 }} minTickGap={40} />
              <YAxis tickFormatter={(v) => fmtCurrency(v, 0)} stroke="#64748b" tick={{ fontSize: 10 }} width={70} orientation="right" />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="cumulative" stroke="#10b981" fill="url(#pnlFill)" strokeWidth={2} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
