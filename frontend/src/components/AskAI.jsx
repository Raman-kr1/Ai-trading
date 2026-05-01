import { useState } from 'react';
import { api } from '../services/api.js';
import { useStore } from '../store/useStore.js';

export default function AskAI() {
  const symbol = useStore((s) => s.symbol);
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);

  async function ask(e) {
    e?.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setHistory((h) => [...h, { role: 'user', symbol, text: q }]);
    setQuestion('');
    try {
      const resp = await api.askAi(symbol, q);
      setHistory((h) => [...h, { role: 'ai', symbol, text: resp.answer || '(no answer)' }]);
    } catch (err) {
      setHistory((h) => [...h, {
        role: 'error', symbol,
        text: err.response?.data?.error || err.message,
      }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel-padded flex flex-col" style={{ minHeight: 280 }}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase tracking-wider text-slate-400">Ask AI · {symbol}</div>
        {history.length > 0 && (
          <button
            onClick={() => setHistory([])}
            className="text-[11px] text-slate-500 hover:text-slate-300"
          >clear</button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto pr-1 mb-2 flex flex-col gap-2 text-xs">
        {history.length === 0 && (
          <div className="text-slate-500">
            Ask anything about {symbol} — e.g. "Is RSI signaling reversal?" or "What's the trend?"
          </div>
        )}
        {history.map((m, i) => (
          <div
            key={i}
            className={
              m.role === 'user'
                ? 'self-end max-w-[85%] px-2.5 py-1.5 rounded-md bg-sky-600/30 border border-sky-500/40 text-sky-100'
                : m.role === 'error'
                  ? 'self-start max-w-[90%] px-2.5 py-1.5 rounded-md bg-rose-600/15 border border-rose-500/30 text-rose-200'
                  : 'self-start max-w-[90%] px-2.5 py-1.5 rounded-md bg-bg-base border border-bg-border text-slate-200 whitespace-pre-wrap'
            }
          >
            {m.text}
          </div>
        ))}
        {busy && <div className="text-slate-500 italic">thinking…</div>}
      </div>

      <form onSubmit={ask} className="flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={`Ask about ${symbol}…`}
          disabled={busy}
          className="flex-1 px-2.5 py-1.5 rounded-md bg-bg-base border border-bg-border text-xs focus:border-sky-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          className="px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs font-medium"
        >Ask</button>
      </form>
    </div>
  );
}
