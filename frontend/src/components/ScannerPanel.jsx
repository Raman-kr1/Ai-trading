import { useState } from 'react';
import { api } from '../services/api.js';
import { useStore } from '../store/useStore.js';
import clsx from 'clsx';

export default function ScannerPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const setSymbol = useStore((s) => s.setSymbol);
  const pushToast = useStore((s) => s.pushToast);

  async function runScan() {
    setLoading(true);
    try {
      setData(await api.scan(3));
    } catch (err) {
      pushToast({ type: 'error', title: 'Scanner failed', message: err.response?.data?.error || err.message });
    } finally {
      setLoading(false);
    }
  }

  const opps = data?.opportunities || [];

  return (
    <div className="panel-padded">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase tracking-wider text-slate-400">Market Scanner</div>
        <button
          onClick={runScan}
          disabled={loading}
          className="text-xs px-2.5 py-1 rounded-md bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium"
        >
          {loading ? 'Scanning…' : 'Run Scan'}
        </button>
      </div>

      {data && (
        <div className="text-[11px] text-slate-500 mb-2">
          {data.actionableCount} actionable / {data.count} scanned · {data.elapsedMs}ms
        </div>
      )}

      {!opps.length && !loading && (
        <div className="text-xs text-slate-500">Click Run Scan to evaluate the watchlist.</div>
      )}

      <div className="flex flex-col gap-1.5">
        {opps.map((o) => {
          const dec = o.decision?.decision || o.status;
          const color = dec === 'BUY' ? 'text-emerald-400'
            : dec === 'SELL' ? 'text-rose-400'
              : 'text-slate-400';
          return (
            <button
              key={o.id}
              onClick={() => setSymbol(o.symbol)}
              className={clsx(
                'text-left px-2.5 py-2 rounded-md border text-xs transition',
                o.actionable
                  ? 'border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/10'
                  : 'border-bg-border hover:border-slate-500'
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{o.symbol}</span>
                  <span className={clsx('font-medium', color)}>{dec}</span>
                  {o.actionable && (
                    <span className="badge bg-emerald-500/15 text-emerald-300 border-emerald-500/30">TOP</span>
                  )}
                </div>
                <div className="text-slate-400">score {o.score}</div>
              </div>
              {o.decision?.reasoning && (
                <div className="text-[11px] text-slate-500 mt-1 line-clamp-2">
                  {o.decision.reasoning}
                </div>
              )}
              {o.decision && o.decision.decision !== 'HOLD' && (
                <div className="text-[11px] text-slate-500 mt-0.5">
                  conf {o.decision.confidence}% · entry {o.decision.entry_price} · SL {o.decision.stop_loss} · TP {o.decision.target_price}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
