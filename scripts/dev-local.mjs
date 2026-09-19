#!/usr/bin/env node
/**
 * npm run devlocal — the whole dev stack, reachable from a phone on the same
 * Wi-Fi.
 *
 * Plain `dev:backend` + `dev:frontend` point everything at localhost, which on
 * a phone means the phone itself: the page loads, then every API call and the
 * login go nowhere. This finds the Mac's LAN IP (it moves with DHCP, so it is
 * looked up on every run rather than written down) and hands both servers the
 * addresses that follow from it. Nothing in .env or .env.local is touched —
 * process env wins over both files, in dotenv and in Next alike.
 *
 * Override the detected address with LAN_IP=192.168.1.8 npm run devlocal
 * (the IP only; the ports are fixed at 3000 and 4000).
 */
import { spawn, spawnSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { createInterface } from 'node:readline';

const BACKEND_PORT = 4000;
const FRONTEND_PORT = 3000;

function lanIp() {
  // Bare host wanted; forgive "http://192.168.1.8:3000" — the ports are ours.
  if (process.env.LAN_IP) return process.env.LAN_IP.replace(/^\w+:\/\//, '').replace(/[:/].*$/, '');
  const nets = networkInterfaces();
  // Wi-Fi / ethernet first; docker, VPN and bridge interfaces are last resort.
  const names = ['en0', 'en1', ...Object.keys(nets).filter((n) => n !== 'en0' && n !== 'en1')];
  for (const name of names) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) {
        return net.address;
      }
    }
  }
  return null;
}

const ip = lanIp();
if (!ip) {
  console.error('devlocal: no LAN IPv4 address found. Connected to Wi-Fi? Or set LAN_IP=...');
  process.exit(1);
}

const apiUrl = `http://${ip}:${BACKEND_PORT}`;
const siteUrl = `http://${ip}:${FRONTEND_PORT}`;

const env = {
  ...process.env,
  FORCE_COLOR: process.env.FORCE_COLOR ?? '1',
  // Frontend: what the browser calls, and the host next dev must accept.
  NEXT_PUBLIC_API_URL: apiUrl,
  NEXT_PUBLIC_SITE_URL: siteUrl,
  DEV_LAN_HOST: ip,
  // Backend: CORS / trusted origins, and the URLs it builds links from. The
  // IP comes first because that is what FRONTEND_URL (email and WhatsApp
  // links) resolves to — a link has to open on the phone.
  FRONTEND_ORIGIN: `${siteUrl},http://localhost:${FRONTEND_PORT}`,
  PUBLIC_API_URL: apiUrl,
  BETTER_AUTH_URL: apiUrl,
};

// ── Database ───────────────────────────────────────────────────────────────
console.log('devlocal: starting the database container…');
const db = spawnSync('docker', ['compose', 'up', '-d', '--wait', 'db'], { stdio: 'inherit' });
if (db.status !== 0) {
  console.warn('devlocal: could not start the db container (is Docker running?). Continuing anyway.');
}

// ── Servers ────────────────────────────────────────────────────────────────
const children = [];
let stopping = false;

function run(label, color, args, port) {
  // Own process group, so stopping it also stops what npm started under it
  // (tsx watch, next dev) instead of orphaning them on the port.
  const child = spawn('npm', args, { env: { ...env, PORT: String(port) }, detached: true });
  const prefix = `\x1b[${color}m[${label}]\x1b[0m `;
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => process.stdout.write(prefix + line + '\n'));
  }
  child.on('exit', (code) => {
    if (!stopping) {
      console.log(`${prefix}exited with code ${code}; stopping the other server.`);
      stop(code ?? 1);
    }
  });
  children.push(child);
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(code), 500);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

run('backend', '36', ['run', 'dev', '-w', 'backend'], BACKEND_PORT);
run('frontend', '35', ['run', 'dev', '-w', 'frontend'], FRONTEND_PORT);

console.log(`
  ┌──────────────────────────────────────────────────────────────┐
    Open on your phone AND on this Mac:  ${siteUrl}
    Backend:                             ${apiUrl}

    Not localhost: the login cookie belongs to ${ip}, so a
    localhost tab can't see it. Same Wi-Fi on the phone.
  └──────────────────────────────────────────────────────────────┘
`);
