import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDb, seedPlatform, users } from '@codela/db';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app';
import { totpAt } from '../src/totp';
import { tenantClient } from './_helpers';

const PW = 'Str0ng-Pass!1';
const mk = () => { const db = createDb(':memory:'); seedPlatform(db); return { db, app: createApp({ db, secureCookies: false, authRateLimitMax: 1000, publicFormRateLimitMax: 1000, rootDomain: 'codela.test' }) }; };
const login = (app: ReturnType<typeof createApp>, email: string, password: string, otp?: string) => request(app).post('/api/v1/auth/login').send({ email, password, otp });

describe('lock-out', () => {
  it('locks a staff account after 5 wrong passwords, even for the right password, and unlocks afterwards', async () => {
    const { db, app } = mk(); await tenantClient(app, 'lck', 'medical');
    for (let i = 0; i < 4; i++) expect((await login(app, 'o@lck.test', 'wrong-pass-1')).body.error.code).toBe('INVALID_CREDENTIALS');
    expect((await login(app, 'o@lck.test', 'wrong-pass-1')).body.error.code).toBe('ACCOUNT_LOCKED');
    const r = await login(app, 'o@lck.test', PW); expect(r.status).toBe(429); expect(r.body.error.code).toBe('ACCOUNT_LOCKED');
    db.update(users).set({ lockedUntil: new Date(Date.now() - 1000).toISOString() }).where(eq(users.email, 'o@lck.test')).run();
    expect((await login(app, 'o@lck.test', PW)).status).toBe(200);
  });
  it('a success resets the counter; unknown e-mails never reveal anything', async () => {
    const { app } = mk(); await tenantClient(app, 'rst2', 'medical');
    for (let i = 0; i < 3; i++) await login(app, 'o@rst2.test', 'wrong-pass-1');
    expect((await login(app, 'o@rst2.test', PW)).status).toBe(200);
    for (let i = 0; i < 4; i++) await login(app, 'o@rst2.test', 'wrong-pass-1');
    expect((await login(app, 'o@rst2.test', PW)).status).toBe(200);          // 4 fresh failures only, not locked
    for (let i = 0; i < 8; i++) expect((await login(app, 'nobody@x.test', 'whatever-123')).body.error.code).toBe('INVALID_CREDENTIALS');
  });
  it('locks a portal account after 5 wrong passwords', async () => {
    const { app } = mk(); await tenantClient(app, 'plk', 'learning');
    const call = (p: string, b: object) => request(app).post(`/api/v1/public/portal${p}`).set('Host', 'plk.codela.test').send(b);
    expect((await call('/register', { name: 'Lock Me', email: 'lock@x.com', password: PW })).status).toBeLessThan(300);
    for (let i = 0; i < 5; i++) await call('/login', { email: 'lock@x.com', password: 'wrong-pass-1' });
    expect((await call('/login', { email: 'lock@x.com', password: PW })).body.error.code).toBe('ACCOUNT_LOCKED');
  });
});

describe('two-factor authentication (TOTP)', () => {
  it('setup → enable → login requires the code; replay and wrong codes fail; disable needs password + code', async () => {
    const { app } = mk(); const t = await tenantClient(app, 'tfa', 'medical'); const h = (x: request.Test) => x.set('x-csrf-token', t.csrf);
    const setup = await h(t.agent.post('/api/v1/auth/2fa/setup')); expect(setup.status).toBe(200); const secret = setup.body.data.secret as string; expect(setup.body.data.otpauthUrl).toContain('otpauth://totp/');
    const step = () => Math.floor(Date.now() / 1000 / 30);
    expect((await h(t.agent.post('/api/v1/auth/2fa/enable').send({ otp: '000000' }))).status).toBe(400);
    const c1 = totpAt(secret, step()); expect((await h(t.agent.post('/api/v1/auth/2fa/enable').send({ otp: c1 }))).body.data.enabled).toBe(true);
    const noOtp = await login(app, 'o@tfa.test', PW); expect(noOtp.status).toBe(401); expect(noOtp.body.error.code).toBe('OTP_REQUIRED');
    expect((await login(app, 'o@tfa.test', PW, '000000')).body.error.code).toBe('INVALID_OTP');
    expect((await login(app, 'o@tfa.test', PW, c1)).body.error.code).toBe('INVALID_OTP');                  // the enabling code is already used
    const c2 = totpAt(secret, step() + 1); const ok = await login(app, 'o@tfa.test', PW, c2); expect(ok.status).toBe(200);
    expect((await login(app, 'o@tfa.test', PW, c2)).status).toBe(401);                                        // replay of the same step
    expect((await h(t.agent.post('/api/v1/auth/2fa/disable').send({ password: 'wrong-pass-1', otp: totpAt(secret, step() + 1) }))).status).toBe(400);
  });
  it('a wrong code counts toward the lock-out', async () => {
    const { app } = mk(); const t = await tenantClient(app, 'tfl', 'medical'); const h = (x: request.Test) => x.set('x-csrf-token', t.csrf);
    const secret = (await h(t.agent.post('/api/v1/auth/2fa/setup'))).body.data.secret as string;
    await h(t.agent.post('/api/v1/auth/2fa/enable').send({ otp: totpAt(secret, Math.floor(Date.now() / 1000 / 30)) }));
    for (let i = 0; i < 5; i++) await login(app, 'o@tfl.test', PW, '111111');
    expect((await login(app, 'o@tfl.test', PW, '111111')).body.error.code).toBe('ACCOUNT_LOCKED');
  });
});
