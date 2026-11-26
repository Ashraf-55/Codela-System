import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDb, seedPlatform } from '@codela/db';
import { createApp } from '../src/app';
import { parseTrustProxy } from '../src/trust-proxy';

describe('parseTrustProxy', () => {
  it('defaults to loopback only', () => { for (const v of [undefined, '', '0', 'false', '  ']) expect(parseTrustProxy(v)).toBe('loopback'); });
  it('accepts a hop count (legacy "1" still means one hop)', () => { expect(parseTrustProxy('1')).toBe(1); expect(parseTrustProxy('2')).toBe(2); });
  it('accepts IPs, CIDRs and keywords', () => {
    expect(parseTrustProxy('10.0.0.0/8')).toBe('10.0.0.0/8');
    expect(parseTrustProxy('loopback, 172.16.0.0/12')).toEqual(['loopback', '172.16.0.0/12']);
    expect(parseTrustProxy('::1')).toBe('::1');
  });
  it('rejects permissive or malformed values', () => {
    for (const v of ['true', 'TRUE', '*', 'all', '0.0.0.0/0', '::/0', '99', 'loopback,0.0.0.0/0', 'not-an-ip', '999.1.1.1', '10.0.0.0/33'])
      expect(() => parseTrustProxy(v), v).toThrow();
  });
});

describe('rate limiting cannot be bypassed with a spoofed X-Forwarded-For', () => {
  const make = (trustProxy: Parameters<typeof createApp>[0]['trustProxy']) => {
    const db = createDb(':memory:'); seedPlatform(db);
    return createApp({ db, secureCookies: false, globalRateLimitMax: 3, trustProxy });
  };
  const hit = async (app: ReturnType<typeof createApp>, n: number) => { const out: number[] = []; for (let i = 0; i < n; i++) out.push((await request(app).get('/api/v1/health').set('X-Forwarded-For', `203.0.113.${i + 1}`)).status); return out; };

  it('ignores X-Forwarded-For from an untrusted peer: every request shares one bucket', async () => {
    // supertest connects from 127.0.0.1, which is NOT inside 10.0.0.0/8, so the header must be ignored.
    const codes = await hit(make('10.0.0.0/8'), 5);
    expect(codes.slice(0, 3)).toEqual([200, 200, 200]); expect(codes.slice(3)).toEqual([429, 429]);
  });
  it('starts no ERR_ERL_PERMISSIVE_TRUST_PROXY validation error with the default configuration', async () => {
    const errors: unknown[] = []; const orig = console.error; console.error = (...a: unknown[]) => { errors.push(a); };
    try { const codes = await hit(make(undefined), 2); expect(codes).toEqual([200, 200]); } finally { console.error = orig; }
    expect(JSON.stringify(errors)).not.toContain('ERR_ERL_PERMISSIVE_TRUST_PROXY');
  });
});
