import { useStore } from '../store/useStore.js';
import clsx from 'clsx';

const STYLES = {
  success: 'bg-emerald-600/90 border-emerald-400/50',
  error:   'bg-rose-600/90 border-rose-400/50',
  warning: 'bg-amber-600/90 border-amber-400/50',
  info:    'bg-sky-600/90 border-sky-400/50',
};

export default function ToastContainer() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={clsx(
            'rounded-lg border px-4 py-3 shadow-xl text-white text-sm transition-all',
            STYLES[t.type] || STYLES.info
          )}
          role="status"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              {t.title && <div className="font-semibold">{t.title}</div>}
              {t.message && <div className="opacity-90 text-xs mt-0.5">{t.message}</div>}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="text-white/70 hover:text-white text-lg leading-none"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
