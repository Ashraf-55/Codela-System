import { createReporter } from '@codela/shared';

// Next.js calls this hook for every server-side rendering / route-handler error. Off unless SENTRY_DSN is set; sends no headers, cookies or bodies.
const reporter = createReporter({ dsn: process.env.SENTRY_DSN, environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV, release: process.env.SENTRY_RELEASE, service: 'web' });
export async function onRequestError(err: unknown, request: { path: string; method: string }) { await reporter.capture(err, { method: request.method, path: request.path }); }
