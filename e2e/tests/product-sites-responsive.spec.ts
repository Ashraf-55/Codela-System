import { expect, test, type Page } from '@playwright/test';

/** For every one of the ten products: the published site and the owner dashboard at desktop / tablet / mobile widths — no horizontal overflow, every menu link of the site really leads somewhere (anchor target exists / page answers 200), clicking works, and the main controls stay reachable. */
const PW = 'Str0ng-Pass!1'; const uid = () => `rs${Math.random().toString(36).slice(2, 8)}`;
const PRODUCTS = ['medical', 'realestate', 'ecommerce', 'restaurant', 'automotive', 'learning', 'construction', 'booking', 'fleet', 'business'] as const;
const VIEWPORTS = [{ n: 'desktop', width: 1280, height: 800 }, { n: 'tablet', width: 820, height: 1180 }, { n: 'mobile', width: 390, height: 844 }];
const overflow = (page: Page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
/** What the visitor can actually do: try to scroll sideways. (scrollWidth alone is inflated by the closed off-canvas menu on the non-scrollable side.) */
const sidewaysScroll = (page: Page) => page.evaluate(() => { window.scrollTo(5000, 0); const x = Math.abs(window.scrollX); window.scrollTo(0, 0); return x; });

for (const product of PRODUCTS) {
  test(`${product}: site + dashboard at desktop / tablet / mobile, working menu links`, async ({ browser }) => {
    test.setTimeout(180_000); // 3 viewports x site + dashboard + every menu link; the default 60 s is too tight when workers run in parallel
    const slug = uid(); const ctx = await browser.newContext(); const api = ctx.request;
    const r = await api.post('/api/v1/auth/register-business', { data: { businessName: `Resp ${product} ${slug}`, slug, productSlug: product, name: 'Owner', email: `o@${slug}.test`, password: PW } });
    expect(r.status(), await r.text()).toBe(201); const h = { 'x-csrf-token': (await r.json()).data.csrfToken as string };
    expect((await api.post('/api/v1/tenant/site/publish', { data: {}, headers: h })).status()).toBe(200);
    const page = await ctx.newPage(); const problems: string[] = []; page.on('pageerror', (e) => problems.push(e.message));
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`/sites/${slug}`); await page.waitForLoadState('networkidle').catch(() => {});
      const o = await overflow(page); expect(o.sw, `${product} site overflows at ${vp.n}`).toBeLessThanOrEqual(o.cw + 1);
      const nav = page.getByRole('navigation', { name: 'Site' }); await expect(nav).toBeVisible();
      const links = await nav.getByRole('link').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? ''));
      expect(links.length, `${product} has no menu links at ${vp.n}`).toBeGreaterThan(0);
      for (const href of links) {
        if (href.startsWith('#')) expect(await page.locator(href).count(), `${product}: menu link ${href} has no target`).toBeGreaterThan(0);
        else if (href.startsWith('/')) { const res = await page.request.get(href); expect(res.status(), `${product}: ${href}`).toBeLessThan(400); }
      }
      // clicking the first anchor link moves the page to its section (when the site uses in-page anchors)
      const anchor = links.find((l) => l.startsWith('#') && l.length > 1);
      if (anchor) { await nav.locator(`a[href="${anchor}"]`).click(); await expect(page).toHaveURL(new RegExp(`${anchor}$`)); await expect(page.locator(anchor)).toBeInViewport({ ratio: 0.01 }); }
      // dashboard
      await page.goto('/app'); await page.waitForLoadState('networkidle').catch(() => {});
      await expect(page.getByRole('main').or(page.locator('main')).first()).toBeVisible();
      expect(await sidewaysScroll(page), `${product} dashboard scrolls sideways at ${vp.n}`).toBeLessThanOrEqual(1);
      if (vp.n === 'mobile') { const menu = page.getByRole('button', { name: /menu|القائمة/i }); if (await menu.count()) { await menu.first().click(); await expect(page.getByRole('link', { name: /settings|الإعدادات/i }).first()).toBeVisible(); } }
    }
    expect(problems, 'script errors').toEqual([]);
  });
}
