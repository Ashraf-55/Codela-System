// One-command production start for hosts that run a single Node process per app (e.g. Hostinger Web Apps):
// the API listens privately on 127.0.0.1:API_PORT (default 4000) and the web app on the host's PORT.
// Runs Next.js and tsx with this same Node binary (process.execPath): some hosts start the app without npm on PATH.
// If either process exits, the other is stopped too so the host's supervisor restarts the whole app.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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

// Hosts whose preset has no build step (e.g. Hostinger "Express"): build the website once if it was never built.
if (!existsSync(at('../apps/web/.next/BUILD_ID'))) {
  console.log('[start-all] no production build found; running next build (first start only)');
  const b = spawnSync(process.execPath, [nextBin, 'build'], { cwd: webDir, stdio: 'inherit' });
  if (b.status !== 0) { console.error(`[start-all] build failed (exit ${b.status}, signal ${b.signal ?? '-'}${b.error ? `, ${b.error.message}` : ''}); the lines above show why`); process.exit(b.status ?? 1); }
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
