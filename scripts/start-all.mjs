// Production entry for hosts that run ONE Node process per app (Hostinger Web Apps, LiteSpeed/Passenger-style runners).
// Everything runs in this single process:
//  * it listens right away (Hostinger requires the entry process itself to call listen() within 3 seconds);
//  * the website (Next.js) is served in-process (custom server);
//  * the API (Express) is built in-process too, and the website's server-side fetch() calls to the internal origin
//    http://codela-api.internal are handed to it in memory (apps/api/src/inproc.ts). No internal network is used — on
//    Hostinger, connections between processes on 127.0.0.1 are refused (ECONNREFUSED), and listen() calls in the
//    entry process are captured by the host.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const root = at('../'), webDir = at('../apps/web/');
const webRequire = createRequire(at('../apps/web/package.json'));
const apiRequire = createRequire(at('../apps/api/package.json'));
const nextBin = webRequire.resolve('next/dist/bin/next');
const val = (v, d) => (v && v.trim() ? v.trim() : d); // an empty variable in a hosting panel counts as unset
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[start-all] ${m}`);
const INTERNAL = 'http://codela-api.internal';
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
const webPort = Number(val(process.env.PORT, '3000')); // read once: the API's env loader may add variables later
server.listen(webPort, () => log(`listening on ${webPort}`)); // first thing: the host waits for this
let stopping = false;
function stop(code) { if (stopping) return; stopping = true; server.close(); setTimeout(() => process.exit(code), 2000).unref(); }
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

/** Load the TypeScript API in this process (tsx loader only while importing it) and route fetch(INTERNAL/...) to it in memory. */
async function mountApi() {
  const { register } = await import(pathToFileURL(apiRequire.resolve('tsx/esm/api')).href);
  const unregister = register();
  const { installCrashHandlers } = await import(pathToFileURL(at('../apps/api/src/monitoring.ts')).href);
  const { buildApi } = await import(pathToFileURL(at('../apps/api/src/build.ts')).href);
  const { createBridge } = await import(pathToFileURL(at('../apps/api/src/inproc.ts')).href); // tested in apps/api/test/inprocess-bridge.test.ts
  await unregister();
  installCrashHandlers();
  const { app, file } = buildApi();
  const bridge = createBridge(app);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async function codelaFetch(input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(`${INTERNAL}/`)) return realFetch(input, init);
    const reqObj = input instanceof Request ? input : null;
    const method = (init?.method ?? reqObj?.method ?? 'GET').toUpperCase();
    const headers = Object.fromEntries(new Headers(init?.headers ?? reqObj?.headers ?? {}));
    let payload = init?.body ?? (reqObj && !['GET', 'HEAD'].includes(method) ? await reqObj.arrayBuffer() : undefined);
    if (payload instanceof ArrayBuffer) payload = Buffer.from(payload); else if (ArrayBuffer.isView(payload)) payload = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
    // the bridge presents the caller as 127.0.0.1 = the website itself, the same trusted hop the API saw before (TRUST_PROXY=loopback)
    const r = await bridge({ method, url: url.slice(INTERNAL.length), headers, payload });
    const out = new Headers(); for (const [k, v] of r.headers) out.append(k, v);
    const noBody = method === 'HEAD' || [101, 204, 205, 304].includes(r.status);
    return new Response(noBody ? null : r.body, { status: r.status, headers: out });
  };
  process.env.API_URL = INTERNAL; // read by the website's server code (lib/server-api.ts) when it first loads
  log(`API mounted in-process (db: ${file})`);
}

async function main() {
  await buildIfMissing();
  await mountApi();
  process.chdir(webDir);
  const app = webRequire('next')({ dev: false, dir: webDir });
  await app.prepare();
  const handle = app.getRequestHandler();
  handler = (req, res) => handle(req, res);
  try { const r = await fetch(`${INTERNAL}/api/v1/health`); log(`API self-check: HTTP ${r.status}`); } catch (e) { log(`API self-check FAILED: ${e?.message ?? e}`); }
  log('website ready');
}
main().catch((e) => { console.error(`[start-all] ${e?.stack ?? e}`); stop(1); });
