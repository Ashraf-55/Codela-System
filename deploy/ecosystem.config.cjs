// pm2: `npm run build && pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup`
// Run from the repository root. Secrets come from <repo>/.env (the API reads it); the web app reads its own env below.
module.exports = { apps: [
  { name: 'codela-api', script: 'npm', args: 'run start:api', cwd: __dirname + '/..', instances: 1, exec_mode: 'fork', autorestart: true, max_memory_restart: '600M', env: { NODE_ENV: 'production', PORT: '4000', TRUST_PROXY: '1' } }, // SQLite: keep exactly ONE instance
  { name: 'codela-web', script: 'npm', args: 'run start:web', cwd: __dirname + '/..', instances: 1, exec_mode: 'fork', autorestart: true, max_memory_restart: '600M', env: { NODE_ENV: 'production', API_URL: 'http://127.0.0.1:4000', WEB_TRUST_PROXY_HOPS: '1' } },
] };
