// One-command production start for hosts that run a single Node process per app (e.g. Hostinger Web Apps):
// the API listens privately on 127.0.0.1:API_PORT (default 4000) and the web app on the host's PORT.
// Runs Next.js and tsx with this same Node binary (process.execPath): some hosts start the app without npm on PATH.
// If either process exits, the other is stopped too so the host's supervisor restarts the whole app.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const webDir = at('../apps/web/'), apiDir = at('../apps/api/');
const nextBin = createRequire(at('../apps/web/package.json')).resolve('next/dist/bin/next');
const tsxBin = createRequire(at('../apps/api/package.json')).resolve('tsx/cli');
const val = (v, d) => (v && v.trim() ? v.trim() : d); // an empty variable in a hosting panel counts as unset
const apiPort = val(process.env.API_PORT, '4000');
const webPort = val(process.env.PORT, '3000');
process.env.NODE_ENV = val(process.env.NODE_ENV, 'production'); // so NODE_ENV need not be set in the panel (setting it there makes npm skip build tools)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exitCode = (child) => new Promise((r) => child.on('exit', (code, signal) => r({ code, signal })).on('error', (e) => r({ code: null, signal: null, error: e })));

// Hosts whose preset has no build step (e.g. Hostinger "Express") get the website built on first start.
// Low-resource mode: one worker, webpack instead of Turbopack (fewer threads), because shared hosts cap processes and threads.
// While building, a tiny placeholder answers on PORT so the host does not kill a "non-responding" app mid-build.
// A lock directory stops two app instances from building at once; the second waits for the first.
const BUILD_ID = at('../apps/web/.next/BUILD_ID'), LOCK = at('../apps/web/.build-lock');
if (!existsSync(BUILD_ID)) {
  const placeholder = createServer((_req, res) => { res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'retry-after': '30' });
    res.end('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="30"><title>Codela</title><body style="font-family:system-ui;display:grid;place-items:center;min-height:90vh;color:#334"><div><h1>Codela is starting…</h1><p>First start: building the website. This page refreshes by itself.</p></div>'); });
  await new Promise((r) => placeholder.listen(Number(webPort), r).on('error', (e) => { console.error(`[start-all] placeholder could not listen: ${e.message}`); r(); }));
  // a lock older than 30 minutes is left over from a killed build
  if (existsSync(LOCK) && Date.now() - statSync(LOCK).mtimeMs > 30 * 60_000) rmSync(LOCK, { recursive: true, force: true });
  let owner = false; try { mkdirSync(LOCK); owner = true; } catch { /* another instance is building */ }
  if (owner) {
    console.log('[start-all] no production build found; running next build (first start only, low-resource mode)');
    const r = await exitCode(spawn(process.execPath, ['--max-old-space-size=1536', nextBin, 'build', '--webpack'], { cwd: webDir, stdio: 'inherit',
      env: { ...process.env, BUILD_LOW_RESOURCES: '1', NEXT_TELEMETRY_DISABLED: '1', UV_THREADPOOL_SIZE: '2' } }));
    rmSync(LOCK, { recursive: true, force: true });
    if (r.code !== 0) { console.error(`[start-all] build failed (exit ${r.code}, signal ${r.signal ?? '-'}${r.error ? `, ${r.error.message}` : ''}); the lines above show why`); await sleep(5000); process.exit(1); }
  } else {
    console.log('[start-all] another instance is building; waiting for it');
    while (!existsSync(BUILD_ID)) { if (!existsSync(LOCK)) { console.error('[start-all] the other build ended without a result; exiting so the host restarts us'); process.exit(1); } await sleep(3000); }
  }
  await new Promise((r) => placeholder.close(() => r()));
  placeholder.closeAllConnections?.();
}

const run = (name, args, cwd, env) => {
  const p = spawn(process.execPath, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
  p.on('exit', (code) => { console.error(`[start-all] ${name} exited (${code}); stopping`); stop(code ?? 1); });
  return p;
};
const kids = [
  run('api', [tsxBin, 'src/server.ts'], apiDir, { PORT: apiPort }),
  run('web', [nextBin, 'start'], webDir, { PORT: webPort, API_URL: val(process.env.API_URL, `http://127.0.0.1:${apiPort}`) }),
];
let stopping = false;
function stop(code) { if (stopping) return; stopping = true; for (const k of kids) k.kill('SIGTERM'); setTimeout(() => process.exit(code), 3000).unref(); }
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => stop(0));
