import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { useStore } from '../store/useStore.js';
import clsx from 'clsx';

/**
 * Global trading kill switch. Big red button — clicking it halts every
 * pipeline run and rejects new trades until released. Auto-engages when
 * daily-loss breach is hit.
 */
export default function KillSwitch() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const pushToast = useStore((s) => s.pushToast);

  async function refresh() {
    try { setStatus(await api.killSwitchStatus()); } catch { /* ignore */ }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, []);

  async function toggle() {
    if (busy || !status) return;
    setBusy(true);
    try {
      const next = status.halted
        ? await api.killSwitchResume('dashboard')
        : await api.killSwitchHalt('manual via dashboard');
      setStatus(next);
      pushToast({
        type: next.halted ? 'error' : 'success',
        title: next.halted ? '🛑 Trading HALTED' : '✅ Trading RESUMED',
        message: next.reason || 'Kill switch toggled',
      });
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Kill switch action failed',
        message: err.response?.data?.error || err.message,
      });
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  const envLocked = status.source === 'env';

  return (
    <div className={clsx(
      'panel-padded border',
      status.halted
        ? 'border-rose-500/50 bg-rose-500/5'
        : 'border-emerald-500/30'
    )}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase tracking-wider text-slate-400">Kill Switch</div>
        <span className={clsx(
          'badge border',
          status.halted
            ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
            : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
        )}>
          {status.halted ? 'HALTED' : 'ACTIVE'}
        </span>
      </div>

      {status.halted && status.reason && (
        <div className="text-xs text-slate-400 mb-2">
          Reason: <span className="text-slate-200">{status.reason}</span>
        </div>
      )}

      <button
        onClick={toggle}
        disabled={busy || envLocked}
        className={clsx(
          'w-full py-2 px-3 rounded-md text-sm font-semibold transition',
          envLocked
            ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
            : status.halted
              ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
              : 'bg-rose-600 hover:bg-rose-500 text-white'
        )}
      >
        {envLocked
          ? 'Locked by TRADING_HALTED env'
          : status.halted ? 'Resume Trading' : 'HALT All Trading'}
      </button>
    </div>
  );
}
