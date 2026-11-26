import { createDb, seedPlatform } from '@codela/db';
import { createApp } from './app';
import { databaseFile, loadEnv } from './env';
import { providersFromEnv } from './providers/notify';
import { startOutboxWorker } from './outbox';
import { installCrashHandlers } from './monitoring';
import { startAddOnScheduler } from './addon-lifecycle';

loadEnv();
installCrashHandlers();
const port = Number(process.env.PORT ?? 4000);
const file = databaseFile();
const db = createDb(file);   // applies pending migrations
seedPlatform(db);            // idempotent: never overwrites admin edits
const providers = providersFromEnv();
startOutboxWorker(db, providers);
startAddOnScheduler(db);     // monthly add-on renewals / expiry (hourly, idempotent)
// E2E / load-test only: raise the per-IP auth + public-form limiters (ignored in production, so the real protection can never be loosened there)
const relax = process.env.NODE_ENV !== 'production' && process.env.E2E_RELAX_RATE_LIMITS === '1' ? { authRateLimitMax: 10_000, publicFormRateLimitMax: 10_000, globalRateLimitMax: 100_000 } : {};
createApp({ db, providers, ...relax }).listen(port, () => console.log(`[api] listening on :${port} (db: ${file})`));
