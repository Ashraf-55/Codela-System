import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * One generic journey per product (all 10): register -> publish the site -> public site renders without script errors or failed
 * requests -> no horizontal scroll at desktop / tablet / mobile -> dashboard loads -> logout -> protected route bounces.
 * Product-specific workflows live in the dedicated specs (medical-journey, security-and-isolation) and in the API test-suite.
 * NOTE: written without being able to run it in the authoring environment; treat the first run as a calibration pass.
 */
const PW = 'Str0ng-Pass!1';
const PRODUCTS = ['medical', 'realestate', 'ecommerce', 'restaurant', 'automotive', 'learning', 'construction', 'booking', 'fleet', 'business'] as const;
const VIEWPORTS = [{ name: 'desktop', width: 1280, height: 800 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'mobile', width: 390, height: 844 }];
const uid = () => `e2e${Math.random().toString(36).slice(2, 9)}`;

async function register(browser: Browser, product: string) {
  const slug = uid(); const ctx = await browser.newContext(); const api = ctx.request;
  const r = await api.post('/api/v1/auth/register-business', { data: { businessName: `E2E ${product} ${slug}`, slug, productSlug: product, name: 'Owner', email: `o@${slug}.test`, password: PW } });
  expect(r.status(), await r.text()).toBe(201); const csrf = (await r.json()).data.csrfToken as string;
  const pub = await api.post('/api/v1/tenant/site/publish', { data: {}, headers: { 'x-csrf-token': csrf } }); expect(pub.status(), await pub.text()).toBe(200);
  return { ctx, api, slug, csrf };
}
function watch(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => { const err = r.failure()?.errorText ?? ''; /* ERR_ABORTED = the browser cancelled a prefetch / superseded navigation; third-party font hosts are unreachable in offline CI */ if (err.includes('ERR_ABORTED') || /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(r.url())) return; problems.push(`requestfailed: ${r.url()} ${err}`); });
  page.on('response', (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
  return problems;
}
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

for (const product of PRODUCTS) {
  test.describe(`${product}`, () => {
    test('public site: renders, has no script errors / failed requests, fits every viewport', async ({ browser }) => {
      const b = await register(browser, product); const page = await b.ctx.newPage(); const problems = watch(page);
      for (const v of VIEWPORTS) {
        await page.setViewportSize({ width: v.width, height: v.height });
        const res = await page.goto(`/sites/${b.slug}`); expect(res?.status(), `${product} ${v.name}`).toBe(200);
        await expect(page.locator('body')).toBeVisible(); await expect(page.locator('h1, h2').first()).toBeVisible();
        expect(await noHScroll(page), `${product}: horizontal scroll at ${v.name}`).toBe(true);
      }
      expect(problems, problems.join('\n')).toEqual([]);
    });

    test('dashboard: owner sees it, logout works, the session is gone afterwards', async ({ browser }) => {
      const b = await register(browser, product); const page = await b.ctx.newPage(); const problems = watch(page);
      await page.goto('/app'); await expect(page).toHaveURL(/\/app/); await expect(page.locator('main#main')).toBeVisible(); // the dashboard shell rendered (a 'main, body' locator matched two elements: strict-mode error)
      for (const v of VIEWPORTS.slice(1)) { await page.setViewportSize({ width: v.width, height: v.height }); await page.goto('/app'); expect(await noHScroll(page), `${product}: dashboard scroll at ${v.name}`).toBe(true); }
      expect((await b.api.post('/api/v1/auth/logout', { data: {}, headers: { 'x-csrf-token': b.csrf } })).status()).toBeLessThan(400);
      expect((await b.api.get('/api/v1/tenant/p-meta')).status()).toBe(401);
      await page.goto('/app'); await expect(page).toHaveURL(/login/);
      expect(problems, problems.join('\n')).toEqual([]);
    });

    test('tenant isolation: a second business of the same product cannot see the first one’s records', async ({ browser }) => {
      const a = await register(browser, product); const c = await register(browser, product);
      const meta = await (await a.api.get('/api/v1/tenant/p-meta')).json();
      const entity = (meta.data.entities as { key: string; fields: Record<string, { required?: boolean; readonly?: boolean; type: string }> }[]).find((e) => Object.values(e.fields).filter((f) => f.required && !f.readonly).every((f) => f.type === 'string'));
      test.skip(!entity, 'no entity creatable with plain string fields');
      const body = Object.fromEntries(Object.entries(entity!.fields).filter(([, f]) => f.required && !f.readonly).map(([k]) => [k, 'Isolation probe']));
      const made = await a.api.post(`/api/v1/tenant/p/${entity!.key}`, { data: body, headers: { 'x-csrf-token': a.csrf } });
      if (made.status() !== 201) test.skip(true, `${entity!.key} not creatable generically`);
      const id = (await made.json()).data.id;
      expect((await c.api.get(`/api/v1/tenant/p/${entity!.key}/${id}`)).status()).toBe(404);
    });
  });
}

test('Super Admin: the tenant session cannot reach the platform API and the login page exists', async ({ browser, page }) => {
  const b = await register(browser, 'business');
  expect((await b.api.get('/api/v1/platform/tenants')).status()).toBe(401);
  await page.goto('/admin/login'); await expect(page.locator('form, input').first()).toBeVisible();
});
