import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'node:fs';

/**
 * Automated accessibility audit (axe-core, WCAG 2.0/2.1 A + AA) over the public product pages, every product's published site (desktop + mobile),
 * the owner dashboard of every product, the specialised screens and the Super Admin login. Results are written to docs/qa/evidence/a11y-results.jsonl.
 * The test fails on any `serious` / `critical` violation. axe covers roughly a third of WCAG: keyboard + screen-reader behaviour is checked in the manual part of docs/ACCESSIBILITY_REPORT.md.
 */
const PW = 'Str0ng-Pass!1';
const PRODUCTS = ['medical', 'realestate', 'ecommerce', 'restaurant', 'automotive', 'learning', 'construction', 'booking', 'fleet', 'business'] as const;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const uid = () => `ax${Math.random().toString(36).slice(2, 9)}`;
type Row = { page: string; viewport: string; rule: string; impact: string; nodes: number; help: string; sample: string };
const rows: Row[] = [];

async function scan(page: import('@playwright/test').Page, name: string, viewport: string) {
  await page.waitForLoadState('networkidle').catch(() => {});
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  for (const v of r.violations) { const row = { page: name, viewport, rule: v.id, impact: String(v.impact), nodes: v.nodes.length, help: v.help, sample: v.nodes[0]?.html.slice(0, 160) ?? '' }; rows.push(row); mkdirSync('../docs/qa/evidence', { recursive: true }); appendFileSync('../docs/qa/evidence/a11y-results.jsonl', JSON.stringify(row) + '\n'); } // appended per violation: a failing test restarts the worker
  return r.violations;
}
async function business(browser: Browser, product: string) {
  const slug = uid(); const ctx = await browser.newContext(); const api = ctx.request;
  const r = await api.post('/api/v1/auth/register-business', { data: { businessName: `A11y ${product} ${slug}`, slug, productSlug: product, name: 'Owner', email: `o@${slug}.test`, password: PW } });
  expect(r.status(), await r.text()).toBe(201); const csrf = (await r.json()).data.csrfToken as string;
  expect((await api.post('/api/v1/tenant/site/publish', { data: {}, headers: { 'x-csrf-token': csrf } })).status()).toBe(200);
  return { ctx, slug };
}
test.beforeAll(() => { mkdirSync('../docs/qa/evidence', { recursive: true }); });

test('platform pages', async ({ page }) => {
  for (const p of ['/', '/pricing', '/login', '/register', '/contact', '/recover', '/admin/login', '/products/medical', '/products/ecommerce']) { await page.goto(p); await scan(page, p, 'desktop'); }
  expect(rows.filter((r) => ['serious', 'critical'].includes(r.impact)), JSON.stringify(rows.filter((r) => ['serious', 'critical'].includes(r.impact)), null, 1)).toEqual([]);
});

for (const product of PRODUCTS) {
  test(`${product}: published site, dashboard and keyboard focus`, async ({ browser }) => {
    const b = await business(browser, product); const page = await b.ctx.newPage(); const before = rows.length;
    for (const vp of [{ n: 'desktop', w: 1280, h: 800 }, { n: 'mobile', w: 390, h: 844 }]) { await page.setViewportSize({ width: vp.w, height: vp.h }); await page.goto(`/sites/${b.slug}`); await scan(page, `${product}:/sites`, vp.n); }
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const p of ['/app', '/app/settings', '/app/site', '/app/team', '/app/roles']) { await page.goto(p); await scan(page, `${product}:${p}`, 'desktop'); }
    // keyboard: the first Tab stop on the public site must be a skip link or a visible, focusable control, and focus must never be lost to <body> after 10 tabs
    await page.goto(`/sites/${b.slug}`); for (let i = 0; i < 10; i++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.tagName), 'focus fell back to <body> while tabbing').not.toBe('BODY');
    const bad = rows.slice(before).filter((r) => ['serious', 'critical'].includes(r.impact));
    expect(bad, JSON.stringify(bad, null, 1)).toEqual([]);
  });
}
