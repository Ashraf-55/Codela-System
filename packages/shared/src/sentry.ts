/**
 * Minimal, dependency-free error reporter that speaks the Sentry ingest protocol (envelope over HTTPS).
 * It is OFF unless a DSN is configured (SENTRY_DSN). It sends only: the error type, a scrubbed message, a trimmed stack, the HTTP method and path.
 * Never cookies, headers, request bodies, query strings or user data. Works with Sentry and any Sentry-compatible server (GlitchTip, self-hosted).
 * Swap in the official SDK later if you need breadcrumbs / performance traces; the call sites (`capture`) stay the same.
 */
export interface ParsedDsn { endpoint: string; key: string; dsn: string }

export function parseDsn(dsn: string | undefined): ParsedDsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn); if (!/^https?:$/.test(u.protocol) || !u.username) return null;
    const parts = u.pathname.split('/').filter(Boolean); const project = parts.pop(); if (!project || !/^\d+$/.test(project)) return null;
    const prefix = parts.length ? `/${parts.join('/')}` : '';
    return { endpoint: `${u.protocol}//${u.host}${prefix}/api/${project}/envelope/`, key: u.username, dsn: `${u.protocol}//${u.username}@${u.host}${prefix}/${project}` };
  } catch { return null; }
}

/** Removes e-mail addresses, long hex/base64 tokens and query strings from free text before it leaves the server. */
export function scrub(s: string): string {
  return s.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]').replace(/\b[A-Fa-f0-9]{24,}\b/g, '[token]').replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[token]').replace(/\?[^\s"')]*/g, '?[query]');
}

export interface ReportOptions { environment?: string; release?: string; service?: string; request?: { method?: string; path?: string } }

export function errorEvent(err: unknown, o: ReportOptions & { eventId: string; now: Date }) {
  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'Non-error thrown');
  return {
    event_id: o.eventId, timestamp: o.now.toISOString(), platform: 'node', level: 'error', environment: o.environment ?? 'production', release: o.release,
    tags: { service: o.service ?? 'codela' }, server_name: undefined,
    exception: { values: [{ type: e.name || 'Error', value: scrub(String(e.message)).slice(0, 500) }] },
    request: o.request?.path ? { method: o.request.method, url: scrub(o.request.path).split('?')[0] } : undefined,
    extra: { stack: scrub(String(e.stack ?? '')).slice(0, 4000) },
  };
}

export function buildEnvelope(d: ParsedDsn, event: { event_id: string }, sentAt: Date): string {
  return `${JSON.stringify({ event_id: event.event_id, sent_at: sentAt.toISOString(), dsn: d.dsn })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}`;
}

export interface Reporter { enabled: boolean; capture: (err: unknown, request?: { method?: string; path?: string }) => Promise<boolean> }
/** `capture` never throws and never blocks the request path for long: failures are swallowed (monitoring must not take the app down). Identical errors are sent at most once a minute, max 30 a minute. */
export function createReporter(o: ReportOptions & { dsn?: string; fetchImpl?: typeof fetch; now?: () => Date }): Reporter {
  const d = parseDsn(o.dsn); const f = o.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined); const now = o.now ?? (() => new Date());
  const seen = new Map<string, number>(); let windowStart = 0, sentInWindow = 0;
  if (!d || !f) return { enabled: false, capture: async () => false };
  return { enabled: true, async capture(err, request) {
    try {
      const t = now().getTime(); if (t - windowStart > 60_000) { windowStart = t; sentInWindow = 0; }
      const e = err instanceof Error ? err : new Error(String(err)); const key = `${e.name}|${e.message}|${request?.path ?? ''}`;
      if (sentInWindow >= 30 || t - (seen.get(key) ?? 0) < 60_000) return false;
      seen.set(key, t); sentInWindow++; if (seen.size > 500) seen.clear();
      const ev = errorEvent(err, { ...o, request: request ?? o.request, eventId: globalThis.crypto.randomUUID().replace(/-/g, ''), now: now() });
      const res = await f(d.endpoint, { method: 'POST', headers: { 'content-type': 'application/x-sentry-envelope', 'x-sentry-auth': `Sentry sentry_version=7, sentry_client=codela/0.1, sentry_key=${d.key}` }, body: buildEnvelope(d, ev, now()), signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch { return false; }
  } };
}
