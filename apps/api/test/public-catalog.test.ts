import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { setup } from './_helpers';

let ctx: ReturnType<typeof setup>;
beforeEach(() => { ctx = setup(); });

describe('public marketing data', () => {
  it('lists active products and their plans without internal fields', async () => {
    const p = await request(ctx.app).get('/api/v1/public/products');
    expect(p.status).toBe(200); expect(p.body.data).toHaveLength(10); expect(p.body.data[0]).toHaveProperty('nameAr'); expect(JSON.stringify(p.body)).not.toMatch(/config|tenantId/);
    const pl = await request(ctx.app).get('/api/v1/public/plans?productSlug=medical');
    expect(pl.status).toBe(200); expect(pl.body.data.map((x: { tier: string }) => x.tier)).toEqual(['starter', 'professional', 'business']);
    expect(pl.body.data[0]).toMatchObject({ priceMonthly: 49900, currency: 'EGP', trialDays: 14 }); expect(pl.body.data[0].limits.maxEmployees).toBe(3);
  });
  it('hides inactive products/plans and validates the query', async () => {
    ctx.db.$client.prepare("update products set status='inactive' where slug='medical'").run();
    expect((await request(ctx.app).get('/api/v1/public/products')).body.data).toHaveLength(9);
    expect((await request(ctx.app).get('/api/v1/public/plans?productSlug=medical')).body.data).toEqual([]);
    ctx.db.$client.prepare("update plans set active=0 where product_slug='fleet' and tier='business'").run();
    expect((await request(ctx.app).get('/api/v1/public/plans?productSlug=fleet')).body.data).toHaveLength(2);
    expect((await request(ctx.app).get('/api/v1/public/plans')).status).toBe(400);
  });
  it('is available through a tenant host too (no tenant leakage)', async () => {
    expect((await request(ctx.app).get('/api/v1/public/products').set('Host', 'alpha.codela.test')).status).toBe(200);
  });
});

describe('public site metadata (drives tenant websites)', () => {
  it('describes the public catalogues and forms of the tenant product', async () => {
    const { tenantClient } = await import('./_helpers');
    await tenantClient(ctx.app, 'alpha', 'medical'); await tenantClient(ctx.app, 'beta', 'restaurant');
    const m = await request(ctx.app).get('/api/v1/public/site-meta').set('Host', 'alpha.codela.test');
    expect(m.status).toBe(200); expect(m.body.data.productSlug).toBe('medical');
    expect(m.body.data.catalogs.map((c: { entity: string }) => c.entity)).toEqual(expect.arrayContaining(['doctor', 'service', 'specialty']));
    expect(m.body.data.catalogs.find((c: { entity: string }) => c.entity === 'doctor').fields).toEqual(expect.arrayContaining([{ key: 'name', type: 'string' }]));
    const f = m.body.data.forms.find((x: { key: string }) => x.key === 'inquiry'); expect(f.fields.phone).toMatchObject({ type: 'phone', required: true });
    expect(JSON.stringify(m.body)).not.toMatch(/tenantId|beforeSave|handler/);
    expect((await request(ctx.app).get('/api/v1/public/site-meta').set('Host', 'beta.codela.test')).body.data.catalogs.map((c: { entity: string }) => c.entity)).toContain('menuItem');
    expect((await request(ctx.app).get('/api/v1/public/site-meta').set('Host', 'nobody.codela.test')).status).toBe(404);
  });
});
