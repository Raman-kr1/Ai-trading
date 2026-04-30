import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore.js';
import { fmtPrice, fmtPct, fmtRelative } from '../utils/format.js';
import Skeleton from './Skeleton.jsx';
import clsx from 'clsx';

export default function PriceCard() {
  const symbol = useStore((s) => s.symbol);
  const price = useStore((s) => s.price);
  const change = useStore((s) => s.change);
  const changePercent = useStore((s) => s.changePercent);
  const flash = useStore((s) => s.priceFlash);
  const lastUpdated = useStore((s) => s.lastUpdated);
  const wsState = useStore((s) => s.wsState);

  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const trendUp = (changePercent ?? 0) >= 0;

  return (
    <div className="panel-padded">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400">Live Price</div>
          <div className="text-lg font-semibold">{symbol}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className={clsx(
            'h-2 w-2 rounded-full',
            wsState === 'connected' ? 'bg-emerald-400 animate-pulse-fast' :
            wsState === 'fallback-polling' ? 'bg-amber-400' :
            wsState === 'connecting' ? 'bg-sky-400 animate-pulse-fast' :
            'bg-rose-500'
          )} />
          <span className="text-xs text-slate-400">{wsState}</span>
        </div>
      </div>

      {price === null ? (
        <Skeleton height="h-12" />
      ) : (
        <div
          key={price}
          className={clsx(
            'text-4xl font-mono font-bold transition-colors duration-300 px-2 -mx-2 rounded',
            flash === 'up' && 'flash-up',
            flash === 'down' && 'flash-down'
          )}
        >
          ${fmtPrice(price)}
        </div>
      )}

      <div className="mt-3 flex items-center gap-3 text-sm">
        <span className={clsx('font-semibold', trendUp ? 'text-accent-buy' : 'text-accent-sell')}>
          {trendUp ? '▲' : '▼'} {fmtPct(changePercent)}
        </span>
        <span className="text-slate-400">{fmtPrice(change, 4)}</span>
        <span className="ml-auto text-xs text-slate-500">{fmtRelative(lastUpdated)}</span>
      </div>
    </div>
  );
}
