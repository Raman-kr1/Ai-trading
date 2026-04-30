import { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';
import { useStore } from '../store/useStore.js';
import { api } from '../services/api.js';
import { fmtPrice, fmtTime } from '../utils/format.js';
import Skeleton from './Skeleton.jsx';
import clsx from 'clsx';

const TIMEFRAMES = [
  { id: '1m',  label: '1m'  },
  { id: '5m',  label: '5m'  },
  { id: '15m', label: '15m' },
];

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-bg-raised border border-bg-border px-3 py-2 rounded-md text-xs shadow-xl">
      <div className="text-slate-400">{fmtTime(p.time)}</div>
      <div className="font-mono font-semibold text-slate-100">${fmtPrice(p.price)}</div>
    </div>
  );
}

export default function PriceChart() {
  const symbol = useStore((s) => s.symbol);
  const livePoints = useStore((s) => s.livePoints);
  const aiDecision = useStore((s) => s.aiDecision);
  const setTimeframe = useStore((s) => s.setTimeframe);
  const timeframe = useStore((s) => s.timeframe);
  const applyMarketData = useStore((s) => s.applyMarketData);

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.marketData({ symbol, timeframe, limit: 200 })
      .then((d) => { if (!cancelled) applyMarketData(d); })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [symbol, timeframe, applyMarketData]);

  const data = useMemo(() => livePoints.slice(-200), [livePoints]);

  const yDomain = useMemo(() => {
    if (!data.length) return ['auto', 'auto'];
    const prices = data.map((d) => d.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const pad = (max - min) * 0.05 || max * 0.001;
    return [min - pad, max + pad];
  }, [data]);

  return (
    <div className="panel-padded">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400">Price Chart</div>
          <div className="text-sm font-semibold">{symbol}</div>
        </div>
        <div className="flex items-center gap-1 bg-bg-raised rounded-lg p-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.id}
              onClick={() => setTimeframe(tf.id)}
              className={clsx(
                'px-3 py-1 text-xs font-semibold rounded-md transition-colors',
                timeframe === tf.id ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
              )}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      <div className="h-72">
        {loading && data.length === 0 ? (
          <Skeleton height="h-full" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2c47" />
              <XAxis
                dataKey="time"
                tickFormatter={fmtTime}
                stroke="#64748b"
                tick={{ fontSize: 11 }}
                minTickGap={40}
              />
              <YAxis
                domain={yDomain}
                tickFormatter={(v) => fmtPrice(v, 0)}
                stroke="#64748b"
                tick={{ fontSize: 11 }}
                width={70}
                orientation="right"
              />
              <Tooltip content={<CustomTooltip />} />
              {aiDecision?.entryPrice ? (
                <ReferenceLine y={aiDecision.entryPrice} stroke="#38bdf8" strokeDasharray="3 3"
                  label={{ value: 'Entry', position: 'right', fill: '#38bdf8', fontSize: 10 }} />
              ) : null}
              {aiDecision?.stopLoss ? (
                <ReferenceLine y={aiDecision.stopLoss} stroke="#ef4444" strokeDasharray="3 3"
                  label={{ value: 'SL', position: 'right', fill: '#ef4444', fontSize: 10 }} />
              ) : null}
              {aiDecision?.targetPrice ? (
                <ReferenceLine y={aiDecision.targetPrice} stroke="#10b981" strokeDasharray="3 3"
                  label={{ value: 'TP', position: 'right', fill: '#10b981', fontSize: 10 }} />
              ) : null}
              <Line
                type="monotone"
                dataKey="price"
                stroke="#38bdf8"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
