import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore.js';
import { api } from '../services/api.js';
import { usePolling } from '../hooks/usePolling.js';
import { fmtTime } from '../utils/format.js';
import clsx from 'clsx';

const LEVELS = ['ALL', 'info', 'warn', 'error'];

const LEVEL_COLORS = {
  error: 'text-rose-400',
  warn:  'text-amber-400',
  info:  'text-emerald-400',
  debug: 'text-slate-400',
  http:  'text-sky-400',
};

export default function LogsViewer() {
  const logs = useStore((s) => s.logs);
  const applyLogs = useStore((s) => s.applyLogs);

  const [level, setLevel] = useState('ALL');
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef(null);

  const fetchLogs = async () => {
    try {
      const params = { limit: 50 };
      if (level !== 'ALL') params.level = level;
      const res = await api.logs(params);
      applyLogs(res.logs || []);
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchLogs(); /* eslint-disable-next-line */ }, [level]);
  usePolling(() => fetchLogs(), 7000, [level]);

  useEffect(() => {
    if (autoScroll && listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [logs, autoScroll]);

  return (
    <div className="panel">
      <div className="px-5 pt-5 pb-2 flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-slate-400">Logs</div>
        <div className="flex items-center gap-2">
          <select value={level} onChange={(e) => setLevel(e.target.value)} className="input py-1 text-xs">
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <label className="flex items-center gap-1 text-xs text-slate-400">
            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
            auto
          </label>
        </div>
      </div>

      <div ref={listRef} className="px-5 pb-5 max-h-80 overflow-y-auto font-mono text-xs space-y-1">
        {logs.length === 0 ? (
          <div className="text-slate-500 py-6 text-center">No logs.</div>
        ) : logs.map((log, i) => (
          <div key={`${log.timestamp || i}-${i}`} className="flex gap-2 leading-relaxed">
            <span className="text-slate-500 shrink-0">{fmtTime(log.timestamp)}</span>
            <span className={clsx('shrink-0 uppercase font-semibold w-12', LEVEL_COLORS[log.level] || 'text-slate-300')}>
              {log.level}
            </span>
            <span className="text-slate-200 break-all">{log.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
