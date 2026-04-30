import { useStore } from '../store/useStore.js';
import AutoManualToggle from './AutoManualToggle.jsx';
import { fmtRelative } from '../utils/format.js';

export default function Header() {
  const symbol = useStore((s) => s.symbol);
  const lastUpdated = useStore((s) => s.lastUpdated);
  const wsState = useStore((s) => s.wsState);

  return (
    <header className="border-b border-bg-border bg-bg-panel/60 backdrop-blur-sm sticky top-0 z-10">
      <div className="max-w-[1600px] mx-auto px-4 lg:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-sky-500 to-emerald-500 flex items-center justify-center font-bold text-sm">
            AI
          </div>
          <div>
            <div className="font-semibold text-sm">AI Trading System</div>
            <div className="text-xs text-slate-400">{symbol} · {fmtRelative(lastUpdated)} · ws: {wsState}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AutoManualToggle />
        </div>
      </div>
    </header>
  );
}
