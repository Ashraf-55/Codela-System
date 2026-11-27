// One-command production start for hosts that run a single Node process per app (e.g. Hostinger Web Apps):
// the API listens privately on 127.0.0.1:API_PORT (default 4000) and the web app on the host's PORT.
// If either process exits, the other is stopped too so the host's supervisor restarts the whole app.
import { spawn } from 'node:child_process';

const apiPort = process.env.API_PORT ?? '4000';
const webPort = process.env.PORT ?? '3000';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (name, script, env) => {
  const p = spawn(npm, ['run', script], { stdio: 'inherit', env: { ...process.env, ...env }, shell: process.platform === 'win32' });
  p.on('exit', (code) => { console.error(`[start-all] ${name} exited (${code}); stopping`); stop(code ?? 1); });
  return p;
};
const kids = [
  run('api', 'start:api', { PORT: apiPort }),
  run('web', 'start:web', { PORT: webPort, API_URL: process.env.API_URL ?? `http://127.0.0.1:${apiPort}` }),
];
let stopping = false;
function stop(code) { if (stopping) return; stopping = true; for (const k of kids) k.kill('SIGTERM'); setTimeout(() => process.exit(code), 3000).unref(); }
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => stop(0));
