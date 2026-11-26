import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { setup, tenantClient } from './_helpers';

let ctx: ReturnType<typeof setup>;
beforeEach(() => { ctx = setup(); });

describe('2FA endpoints require a session', () => {
  it('unauthenticated callers get 401 (not 500) on every /auth/2fa route', async () => {
    for (const [m, u] of [['get', 'status'], ['post', 'setup'], ['post', 'enable'], ['post', 'disable']] as const) {
      const r = await (request(ctx.app) as any)[m](`/api/v1/auth/2fa/${u}`).send({});
      expect([401, 403], `${m} ${u}`).toContain(r.status);
    }
  });
  it('a signed-in owner can start 2FA setup', async () => {
    const t = await tenantClient(ctx.app, 'tfa', 'medical');
    const r = await t.agent.post('/api/v1/auth/2fa/setup').set('x-csrf-token', t.csrf).send({});
    expect(r.status).toBe(200); expect(typeof r.body.data.secret).toBe('string');
  });
});
