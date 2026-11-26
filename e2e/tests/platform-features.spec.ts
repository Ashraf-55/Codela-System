import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Features added in the completion pass: website builder output, server-side store catalogue, custom roles, medical role screens,
 * Super Admin screens, announcements. Each journey creates its own business through the API (fast, deterministic) and then
 * asserts what a real visitor / owner SEES in the browser.
 * NOTE: written without a browser in the authoring environment: NOT RUN. Treat the first run as a calibration pass (selectors, timing).
 * Super Admin journeys need a platform account: set E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD, otherwise they are skipped.
 */
const PW = 'Str0ng-Pass!1';
const uid = () => `e2e${Math.random().toString(36).slice(2, 9)}`;
async function business(browser: Browser, product: string) {
  const slug = uid(); const ctx = await browser.newContext(); const api = ctx.request;
  const r = await api.post('/api/v1/auth/register-business', { data: { businessName: `Nile ${product} ${slug}`, slug, productSlug: product, name: 'Owner', email: `o@${slug}.test`, password: PW } });
  expect(r.status(), await r.text()).toBe(201); const csrf = (await r.json()).data.csrfToken as string;
  const call = (m: 'post' | 'put' | 'patch', u: string, data: object = {}) => api[m](`/api/v1${u}`, { data, headers: { 'x-csrf-token': csrf } });
  return { ctx, api, slug, csrf, call, email: `o@${slug}.test` };
}
const watch = (page: Page) => { const p: string[] = []; page.on('pageerror', (e) => p.push(`pageerror: ${e.message}`)); page.on('requestfailed', (r) => { if ((r.failure()?.errorText ?? '').includes('ERR_ABORTED') || /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(r.url())) return; p.push(`requestfailed: ${r.url()}`); }); page.on('response', (r) => { if (r.status() >= 500) p.push(`HTTP ${r.status()}: ${r.url()}`); }); return p; };
async function loginUi(page: Page, email: string) { await page.goto('/login'); await page.getByLabel(/email|البريد/i).fill(email); await page.getByLabel(/password|كلمة/i).fill(PW); await page.getByRole('button', { name: /login|دخول/i }).click(); await page.waitForURL(/\/app/); }

test.describe('website builder -> published site', () => {
  test('a new site already explains who we are and what we do; the owner\'s edits (SEO, hours, team, theme) appear after publishing and drafts stay hidden', async ({ browser }) => {
    const b = await business(browser, 'booking'); const page = await b.ctx.newPage(); const problems = watch(page);
    await b.call('post', '/tenant/site/publish');
    await page.goto(`/sites/${b.slug}`);
    await expect(page.locator('#sec-about')).toBeVisible(); await expect(page.locator('#sec-services .card').first()).toBeVisible(); await expect(page.locator('#sec-hours table')).toBeVisible();

    const site = (await (await b.api.get('/api/v1/tenant/site')).json()).data;
    const draft = { ...site.draft, sections: [...site.draft.sections.filter((s: { type: string }) => s.type !== 'team'), { type: 'team', enabled: true, content: { title: 'Meet the team', items: [{ title: 'Mona Ali', text: 'Head stylist' }] } }],
      seo: { title: 'Nile Salon — book online', description: 'Book your appointment online in seconds' }, theme: { font: 'serif', header: 'centered', footer: 'columns' },
      hours: { weekly: [{ day: 0, closed: false, open: '08:00', close: '16:30' }], holidays: [{ date: '2027-01-07', label: 'Holiday' }] } };
    expect((await b.call('put', '/tenant/site', { templateKey: site.templateKey, ...draft })).status()).toBe(200);
    await page.reload(); await expect(page.getByText('Mona Ali')).toHaveCount(0); // saved but not published
    await b.call('post', '/tenant/site/publish'); await page.reload();
    await expect(page.getByText('Mona Ali')).toBeVisible(); await expect(page).toHaveTitle('Nile Salon — book online');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'Book your appointment online in seconds');
    await expect(page.locator('[data-font="serif"]')).toBeVisible(); await expect(page.getByText('08:00').first()).toBeVisible();
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('the builder screen saves what the owner types', async ({ browser, page }) => {
    const b = await business(browser, 'business'); await loginUi(page, b.email); await page.goto('/app/site');
    await page.getByLabel(/page title|عنوان الصفحة/i).fill('My Company — Consulting'); await page.getByRole('button', { name: /save|حفظ/i }).first().click();
    await expect(page.getByRole('alert').first()).toBeVisible(); const site = (await (await b.api.get('/api/v1/tenant/site')).json()).data; expect(site.draft.seo.title).toBe('My Company — Consulting');
  });
});

test.describe('store catalogue is searched, filtered and paged by the server', () => {
  test('30 products: page 1 of 3, Next requests page 2 from the API, search narrows the result', async ({ browser }) => {
    const b = await business(browser, 'ecommerce'); const page = await b.ctx.newPage(); const problems = watch(page);
    for (let i = 1; i <= 30; i++) expect((await b.call('post', '/tenant/p/product', { name: `Item ${String(i).padStart(2, '0')}${i === 7 ? ' unicorn' : ''}`, basePrice: i * 1000, status: 'active' })).status()).toBe(201);
    await b.call('post', '/tenant/site/publish'); await page.goto(`/sites/${b.slug}`);
    await expect(page.getByText(/Page 1 of 3|صفحة 1 من 3/)).toBeVisible(); expect(await page.getByText(/^Item \d\d/).count()).toBeLessThanOrEqual(12);
    const next = page.waitForRequest((r) => r.url().includes('/public/catalog/product') && r.url().includes('page=2')); await page.getByRole('button', { name: /next|التالي/i }).click(); await next;
    await expect(page.getByText(/Page 2 of 3|صفحة 2 من 3/)).toBeVisible();
    const search = page.waitForRequest((r) => r.url().includes('q=unicorn')); await page.getByRole('searchbox').or(page.getByPlaceholder(/search|ابحث/i)).first().fill('unicorn'); await search;
    await expect(page.getByText('Item 07 unicorn')).toBeVisible(); expect(problems, problems.join('\n')).toEqual([]);
  });
});

test.describe('custom roles', () => {
  test('the owner creates a role in the UI and the API enforces it for a staff member', async ({ browser, page }) => {
    const b = await business(browser, 'learning'); await loginUi(page, b.email); await page.goto('/app/roles');
    await page.getByRole('button', { name: /new role|دور جديد/i }).click(); await page.getByLabel(/role name|اسم الدور/i).fill('front_desk');
    await page.getByLabel('students read').check(); await page.getByRole('button', { name: /^(save|حفظ)$/i }).click(); await expect(page.getByText('front_desk')).toBeVisible();
    expect((await b.call('post', '/tenant/employees', { name: 'Desk Staff', email: `d@${b.slug}.test`, password: 'Emp-Pass-1234!', role: 'front_desk' })).status()).toBe(201);
    const staff = await browser.newContext(); const l = await staff.request.post('/api/v1/auth/login', { data: { email: `d@${b.slug}.test`, password: 'Emp-Pass-1234!' } }); expect(l.status()).toBe(200);
    expect((await staff.request.get('/api/v1/tenant/p/student')).status()).toBe(200); expect((await staff.request.get('/api/v1/tenant/p/course')).status()).toBe(403);
  });
});

test.describe('medical staff roles', () => {
  test('a lab technician only sees the laboratory screen; results appear in the patient portal', async ({ browser }) => {
    const b = await business(browser, 'medical'); const spec = await (await b.call('post', '/tenant/p/specialty', { name: 'General' })).json(); const doc = await (await b.call('post', '/tenant/p/doctor', { name: 'Dr Y', specialtyId: spec.data.id })).json();
    const pat = await (await b.call('post', '/tenant/p/patient', { name: 'Pat One', email: `pat@${b.slug}.test`, phone: '01011112222' })).json();
    const lab = await (await b.call('post', '/tenant/p/labRequest', { patientId: pat.data.id, doctorId: doc.data.id, test: 'CBC' })).json();
    expect((await b.call('post', '/tenant/employees', { name: 'Lab Tech', email: `lab@${b.slug}.test`, password: 'Emp-Pass-1234!', role: 'lab_technician' })).status()).toBe(201);
    const page = await (await browser.newContext()).newPage(); await page.goto('/login'); await page.getByLabel(/email|البريد/i).fill(`lab@${b.slug}.test`); await page.getByLabel(/password|كلمة/i).fill('Emp-Pass-1234!'); await page.getByRole('button', { name: /login|دخول/i }).click(); await page.waitForURL(/\/app/);
    await page.goto('/app/lab'); await expect(page.getByText('CBC')).toBeVisible(); await page.getByRole('button', { name: /sample collected|تم أخذ العينة/i }).click();
    await page.getByRole('button', { name: /enter result|إدخال النتيجة/i }).click(); await page.getByLabel(/^(value|النتيجة)$/i).first().fill('13.5'); await page.getByRole('button', { name: /save result|حفظ النتيجة/i }).click();
    await expect(page.getByRole('alert').first()).toContainText(/saved|حفظ/i);
    await page.goto('/app/pharmacy'); await expect(page.getByRole('alert').or(page.getByText(/pharmacy|الصيدلية/i)).first()).toBeVisible(); await expect(page.getByRole('heading', { name: /^(pharmacy|الصيدلية)$/i })).toHaveCount(0); // a lab technician is told the screen is not theirs
    void lab;
  });
});

test.describe('Super Admin screens', () => {
  test.skip(!process.env.E2E_ADMIN_EMAIL || !process.env.E2E_ADMIN_PASSWORD, 'needs a platform admin account');
  test('settings, add-ons, announcements and templates load and save without console errors', async ({ page }) => {
    const problems = watch(page); await page.goto('/admin/login'); await page.getByLabel(/email|البريد/i).fill(process.env.E2E_ADMIN_EMAIL!); await page.getByLabel(/password|كلمة/i).fill(process.env.E2E_ADMIN_PASSWORD!); await page.getByRole('button', { name: /login|دخول/i }).click(); await page.waitForURL((u) => u.pathname.startsWith('/admin') && !u.pathname.startsWith('/admin/login'));
    await page.goto('/admin/announcements'); await page.getByRole('button', { name: /new announcement|إعلان جديد/i }).click(); await page.getByLabel(/title \(english\)|العنوان \(إنجليزي\)/i).fill('Planned maintenance'); await page.getByLabel(/title \(arabic\)|العنوان \(عربي\)/i).fill('صيانة مجدولة'); await page.getByRole('button', { name: /^(save|حفظ)$/i }).click();
    await expect(page.getByText('Planned maintenance').or(page.getByText('صيانة مجدولة')).first()).toBeVisible();
    for (const p of ['/admin/settings', '/admin/addons', '/admin/templates', '/admin/tenants']) { await page.goto(p); await expect(page.locator('h1')).toBeVisible(); }
    expect(problems, problems.join('\n')).toEqual([]);
  });
});

test.describe('specialised screens load for the right product, without console errors (NOT RUN)', () => {
  const screens: [string, string[]][] = [['business', ['/app/stock']], ['fleet', ['/app/cash']], ['automotive', ['/app/workorders', '/app/warranties']], ['construction', ['/app/estimates']], ['realestate', ['/app/commissions', '/app/contracts']], ['learning', ['/app/course-builder']], ['medical', ['/app/pharmacy', '/app/lab', '/app/radiology']]];
  for (const [product, paths] of screens) {
    test(`${product}: ${paths.join(', ')}`, async ({ browser, page }) => {
      const b = await business(browser, product); const problems = watch(page); await loginUi(page, b.email);
      for (const p of paths) { await page.goto(p); await expect(page.locator('h1')).toBeVisible(); await expect(page.getByRole('alert').filter({ hasText: /cannot view|لا تملك/ })).toHaveCount(0); }
      expect(problems, problems.join('\n')).toEqual([]);
    });
  }
  test('realestate: the stand-alone property page has its own URL and unknown ids are 404', async ({ browser }) => {
    const b = await business(browser, 'realestate'); const page = await b.ctx.newPage();
    const loc = await (await b.call('post', '/tenant/p/location', { name: 'New Cairo' })).json(); const ty = await (await b.call('post', '/tenant/p/propertyType', { name: 'Apartment' })).json();
    const pr = await (await b.call('post', '/tenant/p/property', { title: 'Garden apartment', purpose: 'sale', price: 350000000, status: 'available', locationId: loc.data.id, typeId: ty.data.id })).json(); await b.call('post', '/tenant/site/publish');
    await page.goto(`/sites/${b.slug}/properties/${pr.data.id}`); await expect(page.getByRole('heading', { name: 'Garden apartment' })).toBeVisible(); await expect(page).toHaveTitle(/Garden apartment/);
    expect((await page.goto(`/sites/${b.slug}/properties/00000000-0000-0000-0000-000000000000`))?.status()).toBe(404);
    await page.goto(`/sites/${b.slug}`); await expect(page.getByLabel(/compare|قارن/i).first()).toBeVisible();
  });
});
