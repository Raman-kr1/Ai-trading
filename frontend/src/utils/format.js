export const fmtPrice = (n, decimals = 2) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

export const fmtPct = (n, decimals = 2) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(decimals)}%`;
};

export const fmtCurrency = (n, decimals = 2) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '$0.00';
  const v = Number(n);
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
};

export const fmtTime = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false });
};

export const fmtDateTime = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString('en-US', { hour12: false })}`;
};

export const fmtRelative = (ts) => {
  if (!ts) return '—';
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 1000) return 'just now';
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
};

export const decisionColor = (decision) => {
  switch ((decision || '').toUpperCase()) {
    case 'BUY':  return 'text-accent-buy';
    case 'SELL': return 'text-accent-sell';
    case 'HOLD': return 'text-accent-hold';
    default:     return 'text-slate-400';
  }
};

export const decisionBg = (decision) => {
  switch ((decision || '').toUpperCase()) {
    case 'BUY':  return 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30';
    case 'SELL': return 'bg-rose-500/15 text-rose-400 border border-rose-500/30';
    case 'HOLD': return 'bg-amber-500/15 text-amber-400 border border-amber-500/30';
    default:     return 'bg-slate-700/40 text-slate-400 border border-slate-700';
  }
};
