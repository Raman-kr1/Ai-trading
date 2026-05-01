import { useState } from 'react';
import { api } from '../services/api.js';
import { useStore } from '../store/useStore.js';
import { usePolling } from '../hooks/usePolling.js';
import Skeleton from './Skeleton.jsx';
import clsx from 'clsx';

/**
 * Live snapshot of trades the Position Monitor is actively watching.
 * Polls /api/positions every 5 s — cheap because the endpoint reads
 * an in-memory map.
 */
export default function OpenPositions() {
  const livePrice = useStore((s) => s.price);
  const [snapshot, setSnapshot] = useState(null);

  usePolling(async () => {
    try {
      const data = await api.positions();
      setSnapshot(data);
    } catch { /* ignore */ }
  }, 5000, []);

  if (!snapshot) {
    return (
      <div className="panel-padded">
        <div className="text-xs uppercase tracking-wider text-slate-400 mb-3">Open Positions</div>
        <Skeleton height="h-24" />
      </div>
    );
  }

  const { tracked, trades } = snapshot;

  return (
    <div className="panel-padded">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-wider text-slate-400">Open Positions</div>
        <span className={clsx(
          'badge border',
          tracked > 0
            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
            : 'bg-slate-500/15 text-slate-400 border-slate-500/30'
        )}>
          {tracked} tracked
        </span>
      </div>

      {tracked === 0 ? (
        <div className="text-sm text-slate-500 py-4 text-center">
          No open positions. Monitor is idle.
        </div>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {trades.map((t) => {
            const distSL = livePrice
              ? ((livePrice - t.stopLoss) / t.stopLoss) * 100 * (t.side === 'BUY' ? 1 : -1)
              : null;
            const distTP = livePrice
              ? ((t.targetPrice - livePrice) / livePrice) * 100 * (t.side === 'BUY' ? 1 : -1)
              : null;
            return (
              <div key={t.tradeId} className="bg-bg-raised rounded-md p-2.5 text-xs">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className={clsx(
                      'badge border',
                      t.side === 'BUY'
                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                        : 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                    )}>
                      {t.side}
                    </span>
                    <span className="font-medium text-slate-200">{t.symbol}</span>
                  </div>
                  <span className="text-slate-500 font-mono">{t.tradeId.slice(-8)}</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-[11px]">
                  <div>
                    <div className="text-slate-500">Entry</div>
                    <div className="font-mono text-slate-300">{t.entryPrice?.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">SL</div>
                    <div className="font-mono text-rose-400">
                      {t.stopLoss?.toFixed(2)}
                      {distSL != null && (
                        <span className="text-slate-500 ml-1">
                          ({distSL >= 0 ? '+' : ''}{distSL.toFixed(2)}%)
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">TP</div>
                    <div className="font-mono text-emerald-400">
                      {t.targetPrice?.toFixed(2)}
                      {distTP != null && (
                        <span className="text-slate-500 ml-1">
                          ({distTP >= 0 ? '+' : ''}{distTP.toFixed(2)}%)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
