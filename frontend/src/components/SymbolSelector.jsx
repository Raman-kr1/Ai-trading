import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { useStore } from '../store/useStore.js';
import clsx from 'clsx';

export default function SymbolSelector() {
  const symbol = useStore((s) => s.symbol);
  const setSymbol = useStore((s) => s.setSymbol);
  const [assets, setAssets] = useState([]);

  useEffect(() => {
    let alive = true;
    api.watchlist().then((d) => { if (alive) setAssets(d.assets || []); }).catch(() => {});
    const t = setInterval(() => {
      api.watchlist().then((d) => { if (alive) setAssets(d.assets || []); }).catch(() => {});
    }, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!assets.length) return null;

  return (
    <div className="panel-padded">
      <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">Watchlist</div>
      <div className="flex flex-wrap gap-2">
        {assets.map((a) => {
          const active = a.symbol === symbol;
          return (
            <button
              key={a.id}
              onClick={() => setSymbol(a.symbol)}
              className={clsx(
                'px-2.5 py-1 rounded-md text-xs border transition flex items-center gap-1.5',
                active
                  ? 'bg-sky-500/20 border-sky-500/50 text-sky-200'
                  : 'border-bg-border text-slate-300 hover:border-slate-500'
              )}
            >
              <span className="font-medium">{a.symbol}</span>
              <span className="text-[10px] text-slate-500">{a.assetClass}</span>
              <span className={clsx(
                'h-1.5 w-1.5 rounded-full',
                a.marketOpen ? 'bg-emerald-400' : 'bg-slate-500'
              )} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
