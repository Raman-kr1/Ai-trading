import { useState } from 'react';
import { useStore } from '../store/useStore.js';
import { api } from '../services/api.js';
import { fmtPrice, decisionBg } from '../utils/format.js';
import clsx from 'clsx';

function rrRatio(entry, sl, tp, side) {
  if (!entry || !sl || !tp) return null;
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  if (risk === 0) return null;
  const valid = side === 'BUY' ? sl < entry && tp > entry : side === 'SELL' ? sl > entry && tp < entry : true;
  return { value: reward / risk, valid };
}

export default function TradePanel() {
  const ai = useStore((s) => s.aiDecision);
  const symbol = useStore((s) => s.symbol);
  const autoTrading = useStore((s) => s.autoTrading);
  const pushToast = useStore((s) => s.pushToast);

  const [executing, setExecuting] = useState(false);

  const decision = ai?.decision || 'HOLD';
  const entry = ai?.entryPrice;
  const sl = ai?.stopLoss;
  const tp = ai?.targetPrice;
  const rr = rrRatio(entry, sl, tp, decision);

  const status = (() => {
    if (decision === 'HOLD') return { label: 'HOLD', color: 'text-amber-400' };
    if (rr && rr.value >= 2 && (ai?.confidence ?? 0) >= 60) return { label: 'APPROVED', color: 'text-emerald-400' };
    return { label: 'REJECTED', color: 'text-rose-400' };
  })();

  async function executeManual() {
    if (executing) return;
    setExecuting(true);
    try {
      const res = await api.execute({ symbol });
      pushToast({ type: 'info', title: 'Trade queued', message: `Job ${res.jobId} for ${symbol}` });
    } catch (err) {
      pushToast({ type: 'error', title: 'Execute failed', message: err?.response?.data?.error || err.message });
    } finally {
      setExecuting(false);
    }
  }

  return (
    <div className="panel-padded">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400">Trade Panel</div>
          <div className="text-sm font-semibold">{symbol}</div>
        </div>
        <span className={clsx('badge', decisionBg(decision))}>{decision}</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Entry"  value={fmtPrice(entry)} />
        <Field label="Stop Loss" value={fmtPrice(sl)} valueClass="text-rose-400" />
        <Field label="Target" value={fmtPrice(tp)} valueClass="text-emerald-400" />
        <Field
          label="R / R"
          value={rr ? `${rr.value.toFixed(2)} : 1` : '—'}
          valueClass={rr && rr.value >= 2 ? 'text-emerald-400' : 'text-amber-400'}
        />
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="text-xs text-slate-400">Risk Engine</div>
        <div className={clsx('text-sm font-semibold', status.color)}>{status.label}</div>
      </div>

      <button
        onClick={executeManual}
        disabled={executing || autoTrading || decision === 'HOLD'}
        className={clsx('mt-4 w-full', decision === 'BUY' ? 'btn-success' : decision === 'SELL' ? 'btn-danger' : 'btn-ghost')}
        title={autoTrading ? 'Switch to Manual mode to execute manually' : ''}
      >
        {executing ? 'Queuing…' : autoTrading ? 'Auto mode active' : `Execute ${decision}`}
      </button>
    </div>
  );
}

function Field({ label, value, valueClass = 'text-slate-100' }) {
  return (
    <div className="bg-bg-raised rounded-md px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={clsx('font-mono font-semibold mt-0.5', valueClass)}>{value}</div>
    </div>
  );
}
