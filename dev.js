#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║            AI TRADING SYSTEM — UNIFIED LAUNCHER          ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * Starts all three services in one terminal:
 *   [BACKEND]  — Express API + WebSocket  (port 3000)
 *   [FRONTEND] — Vite React dashboard     (port 5173)
 *   [WORKER]   — BullMQ trading pipeline  (background)
 *
 * Usage:
 *   node dev.js              # start everything
 *   node dev.js --no-worker  # skip the trading worker
 *   node dev.js --no-frontend
 *   node dev.js --prod       # backend in production mode
 */

'use strict';

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

// ── Flags ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const SKIP_WORKER   = args.includes('--no-worker');
const SKIP_FRONTEND = args.includes('--no-frontend');
const PROD_MODE     = args.includes('--prod');

// ── Paths ────────────────────────────────────────────────────────
const ROOT     = __dirname;
const FRONTEND = path.join(ROOT, 'frontend');

// ── ANSI colour palette ──────────────────────────────────────────
const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  // service colours
  backend:  '\x1b[36m',   // cyan
  frontend: '\x1b[35m',   // magenta
  worker:   '\x1b[33m',   // yellow
  system:   '\x1b[34m',   // blue
  ok:       '\x1b[32m',   // green
  err:      '\x1b[31m',   // red
  warn:     '\x1b[93m',   // bright yellow
};

const pad = (s, n) => s.padEnd(n);

function tag(service) {
  const map = {
    BACKEND:  C.backend,
    FRONTEND: C.frontend,
    WORKER:   C.worker,
    SYSTEM:   C.system,
  };
  const col = map[service] || C.dim;
  return `${col}${C.bold}[${pad(service, 8)}]${C.reset}`;
}

function log(service, line, isErr = false) {
  const ts  = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const col = isErr ? C.err : C.dim;
  process.stdout.write(`${col}${ts}${C.reset} ${tag(service)} ${line}\n`);
}

function syslog(msg, kind = 'ok') {
  const ts = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const col = kind === 'ok' ? C.ok : kind === 'warn' ? C.warn : C.err;
  process.stdout.write(`${col}${ts} ${C.bold}[SYSTEM  ]${C.reset}${col} ${msg}${C.reset}\n`);
}

// ── Banner ───────────────────────────────────────────────────────
function banner() {
  const mode = PROD_MODE ? 'PRODUCTION' : 'DEVELOPMENT';
  process.stdout.write(`
${C.bold}${C.ok}╔══════════════════════════════════════════════════════════╗
║            AI TRADING SYSTEM — UNIFIED LAUNCHER          ║
╠══════════════════════════════════════════════════════════╣
║  ${C.reset}Mode:       ${C.bold}${PROD_MODE ? C.err : C.ok}${mode}${C.reset}${C.bold}${C.ok}                              ║
║  ${C.reset}Backend:    ${C.backend}http://localhost:3000${C.reset}${C.bold}${C.ok}                       ║
║  ${C.reset}Frontend:   ${C.frontend}http://localhost:5173${C.reset}${C.bold}${C.ok}                       ║
║  ${C.reset}WS:         ${C.backend}ws://localhost:3000/ws${C.reset}${C.bold}${C.ok}                      ║
║  ${C.reset}API:        ${C.backend}http://localhost:3000/api${C.reset}${C.bold}${C.ok}                    ║
║  ${C.reset}Worker:     ${SKIP_WORKER ? C.warn + 'disabled' : C.ok + 'enabled '}${C.reset}${C.bold}${C.ok}                                 ║
╚══════════════════════════════════════════════════════════╝${C.reset}
`);
}

// ── Pre-flight checks ────────────────────────────────────────────

async function checkPort(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false)); // port in use
    s.once('listening', () => { s.close(); resolve(true); });
    s.listen(port, '127.0.0.1');
  });
}

async function checkTcpOpen(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => resolve(false));
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
    sock.connect(port, host);
  });
}

async function preflight() {
  let ok = true;

  syslog('Running pre-flight checks…', 'ok');

  // Node version
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 18) {
    syslog(`Node.js ≥ 18 required (found ${process.version})`, 'err');
    ok = false;
  } else {
    syslog(`Node.js ${process.version}  ✓`, 'ok');
  }

  // .env
  if (!fs.existsSync(path.join(ROOT, '.env'))) {
    syslog('.env not found — copy .env.example and fill in keys', 'warn');
  } else {
    syslog('.env found  ✓', 'ok');
  }

  // Redis
  const redisUp = await checkTcpOpen('127.0.0.1', 6379);
  if (redisUp) {
    syslog('Redis :6379  ✓', 'ok');
  } else {
    syslog('Redis not reachable on :6379 — BullMQ worker will fail. Start Redis first.', 'warn');
  }

  // MongoDB
  const mongoUp = await checkTcpOpen('127.0.0.1', 27017);
  if (mongoUp) {
    syslog('MongoDB :27017  ✓', 'ok');
  } else {
    syslog('MongoDB not reachable on :27017 — backend runs degraded (no trade persistence).', 'warn');
  }

  // Port 3000
  const port3free = await checkPort(3000);
  if (!port3free) {
    syslog('Port 3000 is already in use — backend may fail to start.', 'warn');
  } else {
    syslog('Port 3000 free  ✓', 'ok');
  }

  // Port 5173 (frontend)
  if (!SKIP_FRONTEND) {
    const port5free = await checkPort(5173);
    if (!port5free) {
      syslog('Port 5173 is already in use — frontend may fail to start.', 'warn');
    } else {
      syslog('Port 5173 free  ✓', 'ok');
    }
  }

  // npm install check — root
  if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
    syslog('Root node_modules missing — running npm install…', 'warn');
    await npmInstall(ROOT, 'root');
  } else {
    syslog('Root node_modules  ✓', 'ok');
  }

  // npm install check — frontend
  if (!SKIP_FRONTEND) {
    if (!fs.existsSync(path.join(FRONTEND, 'node_modules'))) {
      syslog('Frontend node_modules missing — running npm install…', 'warn');
      await npmInstall(FRONTEND, 'frontend');
    } else {
      syslog('Frontend node_modules  ✓', 'ok');
    }
  }

  return ok;
}

function npmInstall(cwd, label) {
  return new Promise((resolve, reject) => {
    syslog(`npm install [${label}]…`);
    const proc = spawn('npm', ['install', '--no-audit', '--no-fund'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    proc.stdout.on('data', (d) => log('SYSTEM', d.toString().trim()));
    proc.stderr.on('data', (d) => log('SYSTEM', d.toString().trim(), true));
    proc.on('close', (code) => {
      if (code === 0) { syslog(`npm install [${label}] done  ✓`); resolve(); }
      else { syslog(`npm install [${label}] failed (exit ${code})`, 'err'); reject(new Error('npm install failed')); }
    });
  });
}

// ── Process management ───────────────────────────────────────────

const children = [];
let shuttingDown = false;

function spawnService({ name, cmd, args: a = [], cwd = ROOT, env = {} }) {
  const merged = {
    ...process.env,
    FORCE_COLOR: '1',
    ...env,
  };

  const proc = spawn(cmd, a, {
    cwd,
    env: merged,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });

  proc._name = name;

  proc.stdout.on('data', (data) => {
    data.toString().split('\n').forEach((line) => {
      if (line.trim()) log(name, line);
    });
  });

  proc.stderr.on('data', (data) => {
    data.toString().split('\n').forEach((line) => {
      if (line.trim()) log(name, line, true);
    });
  });

  proc.on('close', (code, signal) => {
    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `exit code ${code}`;
    syslog(`${name} stopped (${reason}) — restarting in 3s…`, 'warn');
    setTimeout(() => {
      if (!shuttingDown) spawnService({ name, cmd, args: a, cwd, env });
    }, 3000);
  });

  proc.on('error', (err) => {
    syslog(`Failed to start ${name}: ${err.message}`, 'err');
  });

  children.push(proc);
  syslog(`Started ${name} (PID ${proc.pid})  ✓`);
  return proc;
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write('\n');
  syslog('Shutting down all services…', 'warn');
  for (const proc of children) {
    try {
      process.kill(proc.pid, 'SIGTERM');
    } catch {
      // already dead
    }
  }
  // Force-kill after 5 s if processes hang
  setTimeout(() => {
    for (const proc of children) {
      try { process.kill(proc.pid, 'SIGKILL'); } catch { /* noop */ }
    }
    syslog('All services stopped. Bye.', 'ok');
    process.exit(0);
  }, 5000).unref();
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
process.on('exit',    () => { if (!shuttingDown) shutdown(); });

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  banner();

  const ok = await preflight();

  if (!ok) {
    syslog('Pre-flight failed. Fix the errors above and retry.', 'err');
    process.exit(1);
  }

  process.stdout.write('\n');
  syslog('Starting services…', 'ok');
  process.stdout.write('\n');

  // ── Backend ──────────────────────────────────────────────────
  spawnService({
    name: 'BACKEND',
    cmd: 'node',
    args: ['src/server.js'],
    cwd: ROOT,
    env: {
      NODE_ENV: PROD_MODE ? 'production' : 'development',
    },
  });

  // ── Worker (separate process so it gets its own BullMQ instance)
  if (!SKIP_WORKER) {
    // Give the backend 3s to register the queue before the worker attaches.
    await new Promise((r) => setTimeout(r, 3000));
    spawnService({
      name: 'WORKER',
      cmd: 'node',
      args: ['src/workers/tradingWorker.js'],
      cwd: ROOT,
      env: { NODE_ENV: PROD_MODE ? 'production' : 'development' },
    });
  }

  // ── Frontend ─────────────────────────────────────────────────
  if (!SKIP_FRONTEND) {
    spawnService({
      name: 'FRONTEND',
      cmd: 'npm',
      args: ['run', 'dev'],
      cwd: FRONTEND,
      env: { VITE_BACKEND_URL: `http://localhost:${process.env.PORT || 3000}` },
    });
  }

  process.stdout.write('\n');
  syslog(`All services launched. Press ${C.bold}Ctrl+C${C.reset}${C.ok} to stop.`, 'ok');
  syslog(`Frontend → ${C.frontend}http://localhost:5173${C.reset}`, 'ok');
  syslog(`Backend  → ${C.backend}http://localhost:3000${C.reset}`, 'ok');
  syslog(`API docs → ${C.backend}http://localhost:3000/api${C.reset}`, 'ok');
  syslog(`WS test  → ${C.backend}ws://localhost:3000/ws${C.reset}`, 'ok');
  process.stdout.write('\n');

  // Open the dashboard in the default browser after services warm up.
  if (!SKIP_FRONTEND) {
    const url = 'http://localhost:5173';
    const delay = SKIP_WORKER ? 3000 : 6000; // give Vite a moment to start
    setTimeout(() => {
      const cmd =
        process.platform === 'darwin' ? `open "${url}"` :
        process.platform === 'win32'  ? `start "" "${url}"` :
                                        `xdg-open "${url}"`;
      exec(cmd, (err) => {
        if (!err) syslog(`🌐 Opened browser → ${url}`, 'ok');
      });
    }, delay);
  }
}

main().catch((err) => {
  syslog(`Fatal: ${err.message}`, 'err');
  process.exit(1);
});
