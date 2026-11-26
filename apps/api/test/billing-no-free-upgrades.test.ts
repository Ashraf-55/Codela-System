import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, seedPlatform, subscriptions } from '@codela/db';
import { createApp } from '../src/app';
import { tenantClient } from './_helpers';

// A real (non-sandbox) gateway is active, as in production: nothing may be granted for free.
let db: ReturnType<typeof createDb>; let app: ReturnType<typeof createApp>;
beforeEach(() => {
  vi.stubEnv('PAYMOB_API_KEY', 'k'); vi.stubEnv('PAYMOB_INTEGRATION_ID', '77'); vi.stubEnv('PAYMOB_IFRAME_ID', '88'); vi.stubEnv('PAYMOB_HMAC_SECRET', 'h');
  db = createDb(':memory:'); seedPlatform(db);
  app = createApp({ db, secureCookies: false, authRateLimitMax: 1000, paymentProvider: 'paymob' });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('no free add-ons or upgrades when a real gateway is active', () => {
  it('add-on activation is refused (501) and nothing is granted', async () => {
    const t = await tenantClient(app, 'nfa', 'medical');
    const r = await t.post('/api/v1/tenant/addons/sms_notifications/activate');
    expect(r.status).toBe(501);
    const list = (await t.agent.get('/api/v1/tenant/addons')).body.data as { key: string; status: string }[];
    expect(list.find((a) => a.key === 'sms_notifications')!.status).toBe('available');
  });
  it('a paid (active) subscription cannot be upgraded for free; downgrades still work; trial may pick a tier', async () => {
    const t = await tenantClient(app, 'nfu', 'medical');
    expect((await t.post('/api/v1/tenant/subscription/change-plan', { tier: 'professional' })).status).toBe(200); // trialing: billed at checkout for that plan
    const future = new Date(Date.now() + 20 * 86400000).toISOString();
    db.update(subscriptions).set({ status: 'active', currentPeriodStart: new Date().toISOString(), currentPeriodEnd: future }).where(eq(subscriptions.tenantId, t.tenantId)).run();
    const up = await t.post('/api/v1/tenant/subscription/change-plan', { tier: 'business' });
    expect(up.status).toBe(402); expect(up.body.error.code).toBe('UPGRADE_REQUIRES_PAYMENT');
    expect((await t.post('/api/v1/tenant/subscription/change-plan', { tier: 'starter' })).status).toBe(200);
  });
});
