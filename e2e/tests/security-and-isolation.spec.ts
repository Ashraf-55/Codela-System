import { expect, test } from '@playwright/test';

const PW = 'Str0ng-Pass!1'; const id = () => `e2e${Math.random().toString(36).slice(2, 10)}`;
async function business(browser: import('@playwright/test').Browser, product = 'medical') {
  const slug = id(); const ctx = await browser.newContext();
  const r = await ctx.request.post('/api/v1/auth/register-business', { data: { businessName: `Biz ${slug}`, slug, productSlug: product, name: 'Owner', email: `o@${slug}.test`, password: PW } });
  expect(r.status(), await r.text()).toBe(201); return { ctx, slug, csrf: (await r.json()).data.csrfToken as string, email: `o@${slug}.test` };
}

test('tenant isolation: business B cannot read or change business A records', async ({ browser }) => {
  const a = await business(browser); const b = await business(browser);
  const p = await a.ctx.request.post('/api/v1/tenant/p/patient', { data: { name: 'Secret Patient', phone: '01011112222' }, headers: { 'x-csrf-token': a.csrf } }); expect(p.status()).toBe(201);
  const pid = (await p.json()).data.id;
  expect((await b.ctx.request.get(`/api/v1/tenant/p/patient/${pid}`)).status()).toBe(404);
  expect((await b.ctx.request.patch(`/api/v1/tenant/p/patient/${pid}`, { data: { name: 'x' }, headers: { 'x-csrf-token': b.csrf } })).status()).toBe(404);
  expect(JSON.stringify(await (await b.ctx.request.get('/api/v1/tenant/p/patient')).json())).not.toContain('Secret Patient');
});

test('protected routes: anonymous users are bounced and admin APIs refuse tenant sessions', async ({ page, browser }) => {
  await page.goto('/app'); await expect(page).toHaveURL(/login/);
  const a = await business(browser); expect((await a.ctx.request.get('/api/v1/platform/tenants')).status()).toBe(401);
});

test('login lock-out after repeated wrong passwords', async ({ browser }) => {
  const a = await business(browser); const anon = (await browser.newContext()).request;
  for (let i = 0; i < 5; i++) await anon.post('/api/v1/auth/login', { data: { email: a.email, password: 'wrong-pass-1' } });
  const r = await anon.post('/api/v1/auth/login', { data: { email: a.email, password: PW } }); expect(r.status()).toBe(429);
});

test('uploads: a script disguised as an image is rejected', async ({ browser }) => {
  const a = await business(browser);
  const r = await a.ctx.request.post('/api/v1/tenant/files?purpose=logo', { data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), headers: { 'x-csrf-token': a.csrf, 'content-type': 'application/octet-stream', 'x-file-name': 'logo.png' } });
  expect(r.status()).toBe(415);
});
