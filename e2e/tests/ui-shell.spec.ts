import { expect, test, type Browser } from '@playwright/test';

/**
 * Dashboard shell behaviour added in the seventh pass (design system v3):
 * accessible confirm dialog + toast on delete, keyboard-driven global search, unique navigation links,
 * mobile drawer (tenant + Super Admin), account menu.
 */
const PW = 'Str0ng-Pass!1';
const uid = () => `ui${Math.random().toString(36).slice(2, 9)}`;
async function owner(browser: Browser, product: string, viewport?: { width: number; height: number }) {
  const slug = uid(); const ctx = await browser.newContext({ locale: 'en-US', ...(viewport ? { viewport } : {}) }); await ctx.addCookies([{ name: 'locale', value: 'en', url: process.env.E2E_BASE_URL ?? 'http://localhost:3000' }]);
  const r = await ctx.request.post('/api/v1/auth/register-business', { data: { businessName: `UI ${product} ${slug}`, slug, productSlug: product, name: 'Nora Owner', email: `o@${slug}.test`, password: PW } });
  expect(r.status(), await r.text()).toBe(201); const csrf = (await r.json()).data.csrfToken as string;
  return { ctx, slug, h: { 'x-csrf-token': csrf } };
}

test('delete asks in an accessible dialog: Cancel keeps the record, Delete removes it and confirms with a toast', async ({ browser }) => {
  const o = await owner(browser, 'medical');
  const made = await o.ctx.request.post('/api/v1/tenant/p/patient', { data: { name: 'Dialog Probe', phone: '01000000001', gender: 'female', birthDate: '1991-01-01' }, headers: o.h });
  expect(made.status(), await made.text()).toBe(201); const id = (await made.json()).data.id as string;
  const page = await o.ctx.newPage(); await page.goto(`/app/e/patient/${id}`);
  await page.getByRole('button', { name: /^delete$/i }).click();
  const dlg = page.getByRole('dialog'); await expect(dlg).toBeVisible(); await expect(dlg.getByRole('heading')).toBeVisible();
  await dlg.getByRole('button', { name: /cancel/i }).click(); await expect(dlg).toBeHidden();
  expect((await o.ctx.request.get(`/api/v1/tenant/p/patient/${id}`)).status()).toBe(200); // still there
  await page.getByRole('button', { name: /^delete$/i }).click(); await page.getByRole('dialog').getByRole('button', { name: /^delete$/i }).click();
  await expect(page).toHaveURL(/\/app\/e\/patient$/); await expect(page.getByRole('status').filter({ hasText: 'Deleted' })).toBeVisible();
  expect((await o.ctx.request.get(`/api/v1/tenant/p/patient/${id}`)).status()).toBe(404);
  await o.ctx.close();
});

test('global search: Ctrl+K focuses it, arrow keys pick a result, Enter opens the record', async ({ browser }) => {
  const o = await owner(browser, 'medical');
  const made = await o.ctx.request.post('/api/v1/tenant/p/patient', { data: { name: 'Zeinab Searchable', phone: '01000000002', gender: 'female', birthDate: '1992-02-02' }, headers: o.h });
  const id = (await made.json()).data.id as string;
  const page = await o.ctx.newPage(); await page.goto('/app'); await expect(page.locator('main#main')).toBeVisible();
  // the shortcut listener attaches in an effect right after first paint: retry the key press until the app is interactive (fails if it never works)
  const box = page.getByRole('combobox', { name: /search/i });
  await expect(async () => { await page.keyboard.press('Control+k'); await expect(box).toBeFocused({ timeout: 500 }); }).toPass({ timeout: 10_000 });
  await box.fill('Zeinab'); await expect(page.getByRole('option', { name: /Zeinab Searchable/ })).toBeVisible();
  await box.press('ArrowDown'); await expect(page.getByRole('option', { name: /Zeinab Searchable/ })).toHaveAttribute('aria-selected', 'true');
  await box.press('Enter'); await expect(page).toHaveURL(new RegExp(`/app/e/patient/${id}$`));
  await o.ctx.close();
});

test('navigation has no duplicate links (registry boards + hand-written screens)', async ({ browser }) => {
  for (const product of ['realestate', 'business', 'automotive']) {
    const o = await owner(browser, product); const page = await o.ctx.newPage(); await page.goto('/app'); await expect(page.locator('main#main')).toBeVisible();
    const hrefs = await page.getByRole('navigation', { name: 'Workspace' }).getByRole('link').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(hrefs.length).toBeGreaterThan(1); expect(new Set(hrefs).size, `${product}: ${hrefs.join(', ')}`).toBe(hrefs.length);
    await o.ctx.close();
  }
});

test('account menu: shows who is signed in, switches theme, logs out', async ({ browser }) => {
  const o = await owner(browser, 'booking'); const page = await o.ctx.newPage(); await page.goto('/app');
  await page.getByRole('button', { name: /Nora Owner/ }).click(); const menu = page.getByRole('menu'); await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: /dark mode|light mode/i }).click(); await expect(page.locator('html')).toHaveAttribute('data-theme', /dark|light/);
  await page.keyboard.press('Escape'); await expect(menu).toBeHidden();
  await page.getByRole('button', { name: /Nora Owner/ }).click(); await page.getByRole('menuitem', { name: /log out/i }).click();
  await expect(page).toHaveURL(/login/); expect((await o.ctx.request.get('/api/v1/tenant/p-meta')).status()).toBe(401);
  await o.ctx.close();
});

test('phone: the drawer opens from the menu button, closes with Escape, and has no sideways scroll', async ({ browser }) => {
  const o = await owner(browser, 'fleet', { width: 390, height: 844 }); const page = await o.ctx.newPage(); await page.goto('/app');
  const btn = page.getByRole('button', { name: /^menu$/i }); await expect(btn).toBeVisible(); await expect(page.getByRole('link', { name: /subscription & billing/i })).toBeHidden();
  await btn.click(); await expect(btn).toHaveAttribute('aria-expanded', 'true'); await expect(page.getByRole('link', { name: /subscription & billing/i })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(btn).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await o.ctx.close();
});

test('Super Admin on a phone can reach every section through the menu button', async ({ browser }) => {
  const email = process.env.E2E_ADMIN_EMAIL; const password = process.env.E2E_ADMIN_PASSWORD;
  test.skip(!email || !password, 'set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
  expect((await ctx.request.post('/api/v1/platform/auth/login', { data: { email, password } })).status()).toBe(200);
  const page = await ctx.newPage(); await page.goto('/admin');
  const btn = page.getByRole('button', { name: /menu|القائمة/i }); await expect(btn).toBeVisible(); await btn.click();
  await page.getByRole('link', { name: /tenants|المشتركون|العملاء/i }).first().click(); await expect(page).toHaveURL(/\/admin\/tenants/);
  await ctx.close();
});
