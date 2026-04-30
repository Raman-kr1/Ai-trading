import { useStore } from '../store/useStore.js';
import clsx from 'clsx';

export default function AutoManualToggle() {
  const auto = useStore((s) => s.autoTrading);
  const set = useStore((s) => s.setAutoTrading);

  return (
    <div className="flex items-center gap-1 bg-bg-raised rounded-lg p-1 border border-bg-border">
      <button
        onClick={() => set(true)}
        className={clsx(
          'px-3 py-1 text-xs font-semibold rounded-md transition-colors',
          auto ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
        )}
      >
        AUTO
      </button>
      <button
        onClick={() => set(false)}
        className={clsx(
          'px-3 py-1 text-xs font-semibold rounded-md transition-colors',
          !auto ? 'bg-amber-500 text-white' : 'text-slate-400 hover:text-slate-200'
        )}
      >
        MANUAL
      </button>
    </div>
  );
}
