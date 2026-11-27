// Production entry for hosts that run ONE Node process per app (Hostinger Web Apps, Passenger-style runners).
// The website (Next.js) runs inside this process and listens right away (Hostinger requires the entry process itself
// to call listen() within 3 seconds); the API runs as a private child process on a free 127.0.0.1 port.
// Next.js and tsx run with this same Node binary (process.execPath): the host may start apps without npm on PATH.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as netServer } from 'node:net';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const root = at('../'), webDir = at('../apps/web/'), apiDir = at('../apps/api/');
const webRequire = createRequire(at('../apps/web/package.json'));
const nextBin = webRequire.resolve('next/dist/bin/next');
// tsx as an in-process loader (not its CLI, which forks a second process the IPC channel would not reach)
const tsxLoader = pathToFileURL(createRequire(at('../apps/api/package.json')).resolve('tsx')).href;
const val = (v, d) => (v && v.trim() ? v.trim() : d); // an empty variable in a hosting panel counts as unset
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[start-all] ${m}`);
process.env.NODE_ENV = val(process.env.NODE_ENV, 'production'); // so NODE_ENV need not be set in the panel (setting it there makes npm skip build tools)

// Hostinger deploys each version into .../hbuilds/versions/<id>/: data kept there would vanish on the next deploy.
// Unless absolute paths are configured, keep the database and uploads next to hbuilds (survives redeploys).
const hb = root.split(`${path.sep}hbuilds${path.sep}`);
if (hb.length > 1) {
  const keep = path.join(hb[0], 'codela-data');
  for (const [k, d] of [['DATABASE_FILE', path.join(keep, 'codela.db')], ['UPLOAD_DIR', path.join(keep, 'uploads')]]) {
    if (!path.isAbsolute(val(process.env[k], ''))) { process.env[k] = d; log(`${k} -> ${d} (outside the per-deploy folder)`); }
  }
}

let handler = (_req, res) => { res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'retry-after': '10' });
  res.end('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="10"><title>Codela</title><body style="font-family:system-ui;display:grid;place-items:center;min-height:90vh;color:#334"><div><h1>Codela is starting…</h1><p>This page refreshes by itself.</p></div>'); };
const server = createServer((req, res) => handler(req, res));
server.listen(Number(val(process.env.PORT, '3000')), () => log(`listening on ${val(process.env.PORT, '3000')}`)); // first thing: the host waits for this

const freePort = () => new Promise((r, j) => { const s = netServer(); s.unref(); s.on('error', j); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });
let api = null, stopping = false;
function stop(code) { if (stopping) return; stopping = true; api?.kill('SIGTERM'); server.close(); setTimeout(() => process.exit(code), 2000).unref(); }
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => stop(0));

async function buildIfMissing() {
  // Hosts whose preset has no build step get the website built on first start (low-resource: 1 worker, webpack).
  // Shared plans usually cannot build at all (process caps) — ship apps/web/.next instead (docs/HOSTINGER.md).
  const BUILD_ID = at('../apps/web/.next/BUILD_ID'), LOCK = at('../apps/web/.build-lock');
  if (existsSync(BUILD_ID)) return;
  if (existsSync(LOCK) && Date.now() - statSync(LOCK).mtimeMs > 30 * 60_000) rmSync(LOCK, { recursive: true, force: true });
  let owner = false; try { mkdirSync(LOCK); owner = true; } catch { /* another instance is building */ }
  if (!owner) { log('another instance is building; waiting'); while (!existsSync(BUILD_ID)) { if (!existsSync(LOCK)) throw new Error('the other build ended without a result'); await sleep(3000); } return; }
  log('no production build found; running next build (low-resource mode)');
  const r = await new Promise((res) => spawn(process.execPath, ['--max-old-space-size=1536', nextBin, 'build', '--webpack'], { cwd: webDir, stdio: 'inherit',
    env: { ...process.env, BUILD_LOW_RESOURCES: '1', NEXT_TELEMETRY_DISABLED: '1', UV_THREADPOOL_SIZE: '2' } }).on('exit', (code, signal) => res({ code, signal })).on('error', (e) => res({ code: null, error: e })));
  rmSync(LOCK, { recursive: true, force: true });
  if (r.code !== 0) throw new Error(`build failed (exit ${r.code}, signal ${r.signal ?? '-'}${r.error ? `, ${r.error.message}` : ''}); the lines above show why`);
}

async function main() {
  await buildIfMissing();
  const apiPort = Number(val(process.env.API_PORT, '')) || await freePort(); // a fresh port per start: a lingering old instance can never block it
  process.env.API_URL = val(process.env.API_URL, `http://127.0.0.1:${apiPort}`);
  // 'ipc' lets the API notice when this process dies (it exits on disconnect), so no orphan keeps running
  api = spawn(process.execPath, ['--import', tsxLoader, 'src/server.ts'], { cwd: apiDir, stdio: ['inherit', 'inherit', 'inherit', 'ipc'], env: { ...process.env, PORT: String(apiPort) } });
  api.on('exit', (code) => { log(`api exited (${code}); stopping`); stop(code ?? 1); });
  process.chdir(webDir);
  const app = webRequire('next')({ dev: false, dir: webDir });
  await app.prepare();
  const handle = app.getRequestHandler();
  handler = (req, res) => handle(req, res);
  log(`website ready; API on 127.0.0.1:${apiPort}`);
}
main().catch((e) => { console.error(`[start-all] ${e?.stack ?? e}`); stop(1); });
