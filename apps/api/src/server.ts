import { createDb, seedPlatform } from '@codela/db';
import { createApp } from './app';
import { databaseFile, loadEnv } from './env';
import { providersFromEnv } from './providers/notify';
import { startOutboxWorker } from './outbox';
import { installCrashHandlers } from './monitoring';
import { startAddOnScheduler } from './addon-lifecycle';
import { bootstrapAdmin } from './bootstrap-admin';

loadEnv();
installCrashHandlers();
// Started by scripts/start-all.mjs with an IPC channel: exit when that parent dies, so no orphan API keeps its port.
if (process.send) process.on('disconnect', () => process.exit(0));
const port = Number(process.env.PORT ?? 4000);
const file = databaseFile();
const db = createDb(file);   // applies pending migrations
seedPlatform(db);            // idempotent: never overwrites admin edits
bootstrapAdmin(db, process.env).then((r) => r === 'created' && console.log('[api] first super admin created from ADMIN_EMAIL')).catch((e) => console.error(`[api] could not create the first super admin: ${(e as Error).message}`));
const providers = providersFromEnv();
startOutboxWorker(db, providers);
startAddOnScheduler(db);     // monthly add-on renewals / expiry (hourly, idempotent)
// E2E / load-test only: raise the per-IP auth + public-form limiters (ignored in production, so the real protection can never be loosened there)
const relax = process.env.NODE_ENV !== 'production' && process.env.E2E_RELAX_RATE_LIMITS === '1' ? { authRateLimitMax: 10_000, publicFormRateLimitMax: 10_000, globalRateLimitMax: 100_000 } : {};
createApp({ db, providers, ...relax }).listen(port, () => console.log(`[api] listening on :${port} (db: ${file})`));
