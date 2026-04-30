import { useStore } from '../store/useStore.js';
import { decisionBg, fmtPrice, fmtRelative } from '../utils/format.js';
import Skeleton from './Skeleton.jsx';
import clsx from 'clsx';

function ConfidenceBar({ value = 0 }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const color = v >= 75 ? 'bg-emerald-500' : v >= 60 ? 'bg-sky-500' : v >= 40 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="w-full">
      <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
        <span>Confidence</span>
        <span className="font-mono font-semibold text-slate-200">{v.toFixed(0)}%</span>
      </div>
      <div className="h-2 bg-bg-raised rounded-full overflow-hidden">
        <div
          className={clsx('h-full rounded-full transition-all duration-700', color)}
          style={{ width: `${v}%` }}
        />
      </div>
    </div>
  );
}

export default function AIDecisionCard() {
  const ai = useStore((s) => s.aiDecision);

  if (!ai) {
    return (
      <div className="panel-padded">
        <div className="text-xs uppercase tracking-wider text-slate-400 mb-3">AI Decision</div>
        <Skeleton height="h-8" className="mb-3" />
        <Skeleton height="h-2" />
      </div>
    );
  }

  const decision = ai.decision || 'HOLD';
  const confidence = Number(ai.confidence ?? 0);
  const indicators = ai.indicators || {};
  const trend = (indicators.signals?.emaCrossover || '').toUpperCase();

  return (
    <div className="panel-padded">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-wider text-slate-400">AI Decision</div>
        <span className="text-xs text-slate-500">{fmtRelative(ai.timestamp || ai.createdAt)}</span>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <span className={clsx('text-3xl font-bold px-3 py-1 rounded-lg', decisionBg(decision))}>
          {decision}
        </span>
        <div className="text-sm">
          <div className="text-slate-400">Trend</div>
          <div className={clsx('font-semibold', trend === 'BULLISH' ? 'text-accent-buy' : trend === 'BEARISH' ? 'text-accent-sell' : 'text-slate-300')}>
            {trend || '—'}
          </div>
        </div>
      </div>

      <ConfidenceBar value={confidence} />

      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        <Stat label="Entry"  value={fmtPrice(ai.entryPrice)} />
        <Stat label="Stop"   value={fmtPrice(ai.stopLoss)} accent="text-rose-400" />
        <Stat label="Target" value={fmtPrice(ai.targetPrice)} accent="text-emerald-400" />
      </div>

      {ai.reasoning && (
        <p className="mt-3 text-xs text-slate-400 leading-relaxed line-clamp-3">
          {ai.reasoning}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, accent = 'text-slate-100' }) {
  return (
    <div className="bg-bg-raised rounded-md px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={clsx('font-mono font-semibold mt-0.5', accent)}>{value}</div>
    </div>
  );
}
