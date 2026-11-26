import { createReporter } from '@codela/shared';

/** Error monitoring (Sentry-compatible). Disabled unless SENTRY_DSN is set. See docs/PRODUCTION.md > Monitoring. */
export const monitor = createReporter({ dsn: process.env.SENTRY_DSN, environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'production', release: process.env.SENTRY_RELEASE, service: 'api' });

/** Process-level safety net: reports and logs crashes. Call once from the server entry (never from tests). */
export function installCrashHandlers(): void {
  process.on('unhandledRejection', (reason) => { console.error('[api] unhandledRejection', reason instanceof Error ? reason.message : reason); void monitor.capture(reason); });
  process.on('uncaughtException', (err) => { console.error('[api] uncaughtException', err.message); void monitor.capture(err).finally(() => process.exit(1)); });
}
