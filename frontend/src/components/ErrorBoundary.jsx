import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('Dashboard crashed:', error, info);
  }
  reset = () => this.setState({ error: null });
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-bg-base text-slate-200">
        <div className="panel-padded max-w-lg w-full">
          <h1 className="text-xl font-bold mb-2 text-rose-400">Dashboard Error</h1>
          <p className="text-sm text-slate-400 mb-3">
            Something went wrong rendering the UI. The backend is unaffected.
          </p>
          <pre className="bg-bg-raised text-rose-300 text-xs p-3 rounded overflow-auto max-h-48">
            {String(this.state.error?.stack || this.state.error)}
          </pre>
          <button onClick={this.reset} className="btn-primary mt-4">Reload UI</button>
        </div>
      </div>
    );
  }
}
