import Header from '../components/Header.jsx';
import PriceCard from '../components/PriceCard.jsx';
import AIDecisionCard from '../components/AIDecisionCard.jsx';
import PriceChart from '../components/PriceChart.jsx';
import TradePanel from '../components/TradePanel.jsx';
import TradeHistory from '../components/TradeHistory.jsx';
import SystemStatus from '../components/SystemStatus.jsx';
import KillSwitch from '../components/KillSwitch.jsx';
import OpenPositions from '../components/OpenPositions.jsx';
import SymbolSelector from '../components/SymbolSelector.jsx';
import ScannerPanel from '../components/ScannerPanel.jsx';
import AskAI from '../components/AskAI.jsx';
import LogsViewer from '../components/LogsViewer.jsx';
import PnLChart from '../components/PnLChart.jsx';
import ToastContainer from '../components/Toast.jsx';
import { useWebSocket } from '../hooks/useWebSocket.js';

export default function Dashboard() {
  useWebSocket();

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <ToastContainer />

      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 lg:px-6 py-5 grid grid-cols-12 gap-4">
        {/* Watchlist selector spans full width */}
        <section className="col-span-12"><SymbolSelector /></section>

        {/* Top row */}
        <section className="col-span-12 lg:col-span-4"><PriceCard /></section>
        <section className="col-span-12 lg:col-span-4"><AIDecisionCard /></section>
        <section className="col-span-12 lg:col-span-4"><TradePanel /></section>

        {/* Middle row */}
        <section className="col-span-12 lg:col-span-8 flex flex-col gap-4">
          <PriceChart />
          <AskAI />
        </section>
        <section className="col-span-12 lg:col-span-4 flex flex-col gap-4">
          <KillSwitch />
          <ScannerPanel />
          <SystemStatus />
          <OpenPositions />
          <PnLChart />
        </section>

        {/* Bottom row */}
        <section className="col-span-12 lg:col-span-8"><TradeHistory /></section>
        <section className="col-span-12 lg:col-span-4"><LogsViewer /></section>
      </main>

      <footer className="border-t border-bg-border py-3 text-center text-xs text-slate-500">
        AI Trading System · paper-first · respect risk limits
      </footer>
    </div>
  );
}
