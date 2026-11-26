import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createDb, seedPlatform, users, sessions } from '@codela/db';
import { createApp } from '../src/app';
import { tenantClient } from './_helpers';

const PW = 'Str0ng-Pass!1', NEW_PW = 'N3w-Strong-Pass!2';
function build(staffEmailVerification: boolean) {
  const db = createDb(':memory:'); seedPlatform(db); const sent: { to: string; subject?: string; body: string }[] = [];
  const app = createApp({ db, secureCookies: false, authRateLimitMax: 1000, publicFormRateLimitMax: 1000, rootDomain: 'codela.test', staffEmailVerification,
    providers: { email: { send: async (m) => { sent.push(m); } } } });
  return { db, app, sent };
}
const wait = () => new Promise((s) => setTimeout(s, 30));
const tokenOf = (body: string, key: 'reset' | 'verify') => new RegExp(`[?&]${key}=([^\\s]+)`).exec(body)![1];
const post = (app: ReturnType<typeof createApp>, u: string, b: object) => request(app).post(`/api/v1${u}`).send(b);
const login = (app: ReturnType<typeof createApp>, email: string, password: string) => post(app, '/auth/login', { email, password });

describe('staff / owner password reset (signed, single-use, delivered through the outbox)', () => {
  it('answers identically for unknown accounts, mails a link, changes the password once and revokes every session', async () => {
    const { app, db, sent } = build(false); const t = await tenantClient(app, 'rec1', 'medical');
    expect((await t.agent.get('/api/v1/auth/me')).status).toBe(200);

    const unknown = await post(app, '/auth/forgot-password', { email: 'nobody@nowhere.test' }); await wait();
    expect(unknown.status).toBe(200); expect(unknown.body).toEqual({ data: { ok: true } }); expect(sent.length).toBe(0);

    const known = await post(app, '/auth/forgot-password', { email: 'O@rec1.test' }); await wait();
    expect(known.status).toBe(200); expect(known.body).toEqual(unknown.body);   // no account enumeration
    expect(sent.length).toBe(1); expect(sent[0].to).toBe('o@rec1.test'); expect(sent[0].body).toContain('/recover?reset=');
    const token = tokenOf(sent[0].body, 'reset');

    expect((await post(app, '/auth/reset-password', { token: 'forged.token', password: NEW_PW })).status).toBe(400);
    expect((await post(app, '/auth/reset-password', { token, password: 'weak' })).status).toBe(400);   // password policy still applies
    expect((await post(app, '/auth/reset-password', { token, password: NEW_PW })).status).toBe(200);

    expect((await post(app, '/auth/reset-password', { token, password: 'An0ther-Pass!3' })).status).toBe(400);   // single use: bound to the old hash
    expect((await t.agent.get('/api/v1/auth/me')).status).toBe(401);                                              // the old session is gone
    expect((await login(app, 'o@rec1.test', PW)).status).toBe(401);
    expect((await login(app, 'o@rec1.test', NEW_PW)).status).toBe(200);
    expect(db.select().from(sessions).where(eq(sessions.userId, db.select().from(users).where(eq(users.email, 'o@rec1.test')).get()!.id)).all().length).toBe(1);
  });

  it('a reset also clears a lock-out', async () => {
    const { app, sent } = build(false); await tenantClient(app, 'rec2', 'medical');
    for (let i = 0; i < 5; i++) await login(app, 'o@rec2.test', 'wrong-Pass-1');
    expect((await login(app, 'o@rec2.test', PW)).body.error.code).toBe('ACCOUNT_LOCKED');
    await post(app, '/auth/forgot-password', { email: 'o@rec2.test' }); await wait();
    expect((await post(app, '/auth/reset-password', { token: tokenOf(sent[0].body, 'reset'), password: NEW_PW })).status).toBe(200);
    expect((await login(app, 'o@rec2.test', NEW_PW)).status).toBe(200);
  });

  it('a tampered link is refused, and a suspended or unknown account gets no mail', async () => {
    const { app, db, sent } = build(false); await tenantClient(app, 'rec3', 'medical'); await tenantClient(app, 'rec4', 'medical');
    await post(app, '/auth/forgot-password', { email: 'o@rec3.test' }); await wait();
    const token = tokenOf(sent[0].body, 'reset');
    expect((await post(app, '/auth/reset-password', { token: `${token}x`, password: NEW_PW })).status).toBe(400);   // tampered signature
    db.update(users).set({ status: 'suspended' }).where(eq(users.email, 'o@rec4.test')).run();
    await post(app, '/auth/forgot-password', { email: 'o@rec4.test' }); await wait(); expect(sent.length).toBe(1);
  });
});

describe('staff / owner e-mail verification', () => {
  it('registration mails a link; using it marks the e-mail verified; replay is harmless; tampering fails', async () => {
    const { app, db, sent } = build(true); await tenantClient(app, 'ver1', 'medical'); await wait();
    expect(sent.length).toBe(1); expect(sent[0].to).toBe('o@ver1.test');
    expect(db.select().from(users).where(eq(users.email, 'o@ver1.test')).get()!.emailVerifiedAt).toBeNull();
    const token = tokenOf(sent[0].body, 'verify');
    expect((await post(app, '/auth/verify-email', { token: 'forged.token' })).status).toBe(400);
    expect((await post(app, '/auth/verify-email', { token })).status).toBe(200);
    expect(db.select().from(users).where(eq(users.email, 'o@ver1.test')).get()!.emailVerifiedAt).toBeTruthy();
    expect((await post(app, '/auth/verify-email', { token })).status).toBe(200);
  });

  it('resend answers identically for unknown and already verified accounts', async () => {
    const { app, sent } = build(true); await tenantClient(app, 'ver2', 'medical'); await wait(); const before = sent.length;
    expect((await post(app, '/auth/resend-verification', { email: 'nobody@nowhere.test' })).body).toEqual({ data: { ok: true } });
    expect((await post(app, '/auth/resend-verification', { email: 'o@ver2.test' })).body).toEqual({ data: { ok: true } }); await wait();
    expect(sent.length).toBe(before + 1);
    await post(app, '/auth/verify-email', { token: tokenOf(sent[sent.length - 1].body, 'verify') });
    await post(app, '/auth/resend-verification', { email: 'o@ver2.test' }); await wait(); expect(sent.length).toBe(before + 1);   // nothing left to verify
  });

  it('sends nothing when verification is switched off', async () => {
    const { app, sent } = build(false); await tenantClient(app, 'ver3', 'medical'); await wait(); expect(sent.length).toBe(0);
  });
});
