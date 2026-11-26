import { describe, expect, it } from 'vitest';
import { buildEnvelope, createReporter, errorEvent, parseDsn, scrub } from '../src/sentry';

const DSN = 'https://abc123@o1.ingest.example.io/4501';
describe('sentry-compatible reporter', () => {
  it('parses a DSN into the envelope endpoint and rejects malformed ones', () => {
    expect(parseDsn(DSN)).toEqual({ endpoint: 'https://o1.ingest.example.io/api/4501/envelope/', key: 'abc123', dsn: DSN });
    expect(parseDsn('https://k@sentry.mycorp.test/errors/7')!.endpoint).toBe('https://sentry.mycorp.test/errors/api/7/envelope/');   // self-hosted under a path
    for (const bad of [undefined, '', 'not a url', 'ftp://k@h/1', 'https://h/1', 'https://k@h/abc']) expect(parseDsn(bad)).toBeNull();
  });
  it('scrubs e-mail addresses, tokens and query strings', () => {
    expect(scrub('failed for sara@example.com')).toBe('failed for [email]');
    expect(scrub('token a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6 bad')).toBe('token [token] bad');
    expect(scrub('GET /x?reset=SECRET&a=1')).toBe('GET /x?[query]');
  });
  it('builds a three-line envelope with no cookies, headers or bodies', () => {
    const ev = errorEvent(new TypeError('boom for a@b.co'), { eventId: 'e'.repeat(32), now: new Date('2030-01-01T00:00:00Z'), request: { method: 'POST', path: '/api/v1/x?token=1' }, service: 'api' });
    expect(ev.exception.values[0]).toEqual({ type: 'TypeError', value: 'boom for [email]' }); expect(ev.request).toEqual({ method: 'POST', url: '/api/v1/x' });
    const lines = buildEnvelope(parseDsn(DSN)!, ev, new Date('2030-01-01T00:00:00Z')).split('\n'); expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[1])).toEqual({ type: 'event' }); expect(JSON.stringify(ev)).not.toMatch(/cookie|authorization|password/i);
  });
  it('is disabled without a DSN, never throws, dedupes and rate-limits', async () => {
    expect((await createReporter({}).capture(new Error('x')))).toBe(false); expect(createReporter({}).enabled).toBe(false);
    const calls: { url: string; init: RequestInit }[] = []; let t = 1_000_000;
    const r = createReporter({ dsn: DSN, service: 'api', now: () => new Date(t), fetchImpl: (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch });
    expect(await r.capture(new Error('same'), { method: 'GET', path: '/a' })).toBe(true); expect(await r.capture(new Error('same'), { method: 'GET', path: '/a' })).toBe(false);   // duplicate inside a minute
    expect(calls).toHaveLength(1); expect(calls[0].url).toBe('https://o1.ingest.example.io/api/4501/envelope/'); expect((calls[0].init.headers as Record<string, string>)['x-sentry-auth']).toContain('sentry_key=abc123');
    for (let i = 0; i < 40; i++) await r.capture(new Error(`distinct ${i}`)); expect(calls.length).toBeLessThanOrEqual(30);
    t += 120_000; expect(await r.capture(new Error('same'), { method: 'GET', path: '/a' })).toBe(true);
    const broken = createReporter({ dsn: DSN, fetchImpl: (async () => { throw new Error('network down'); }) as unknown as typeof fetch }); expect(await broken.capture(new Error('x'))).toBe(false);
  });
});
