import { expect, test, type Browser } from '@playwright/test';
import { deflateSync } from 'node:zlib';

const PW = 'Str0ng-Pass!1'; const uid = () => `sb${Math.random().toString(36).slice(2, 9)}`;
function crc(b: Buffer) { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; }
const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
/** A real PNG: left half red, right half blue. */
function png(w: number, h: number) { const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = x < w / 2 ? 220 : 20; raw[o + 1] = 20; raw[o + 2] = x < w / 2 ? 20 : 220; } const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); }
async function owner(browser: Browser, product = 'booking') {
  const slug = uid(); const ctx = await browser.newContext(); const api = ctx.request;
  const r = await api.post('/api/v1/auth/register-business', { data: { businessName: `Builder ${slug}`, slug, productSlug: product, name: 'Owner', email: `o@${slug}.test`, password: PW } });
  expect(r.status(), await r.text()).toBe(201); const csrf = (await r.json()).data.csrfToken as string;
  return { ctx, api, csrf, slug, h: { 'x-csrf-token': csrf } };
}

test.describe('Website builder', () => {
  test('drag-and-drop section order is saved in the database and used by the published site', async ({ browser }) => {
    const o = await owner(browser); const page = await o.ctx.newPage(); await page.setViewportSize({ width: 1280, height: 3200 }); // tall viewport: source and target must both be on screen for a native drag
    await page.goto('/app/site'); const cards = page.getByTestId('section-card'); await expect(cards.first()).toBeVisible();
    const types = async () => cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-type') ?? ''));
    const before = await types(); expect(before.length).toBeGreaterThanOrEqual(3);
    const moved = before[2]; await page.getByTestId('drag-handle').nth(2).dragTo(cards.nth(0)); // drop the 3rd section on the 1st
    const after = await types(); expect(after[0]).toBe(moved); expect(after.length).toBe(before.length);
    await page.getByRole('button', { name: /^(save|حفظ)$/i }).click(); await expect(page.getByRole('alert').first()).toBeVisible();
    const draft = (await (await o.api.get('/api/v1/tenant/site')).json()).data.draft.sections.map((s: { type: string }) => s.type); expect(draft).toEqual(after); // persisted, not just visual
    await page.getByRole('button', { name: /^(publish|نشر)$/i }).click(); await expect(page.getByRole('alert').first()).toBeVisible();
    await page.reload(); await expect(cards.first()).toBeVisible(); expect(await types()).toEqual(after);                                            // survives a reload
    await page.goto(`/sites/${o.slug}`);
    const ids = await page.locator('main [id^="sec-"]').evaluateAll((els) => els.map((e) => e.id.replace('sec-', '')));
    const expectOrder = after.filter((x) => ids.includes(x)); expect(ids.filter((x) => expectOrder.includes(x))).toEqual(expectOrder);
  });

  test('per-page SEO slugs: create, validate duplicates and reserved words, publish, route, title, menu link', async ({ browser }) => {
    const o = await owner(browser); const page = await o.ctx.newPage(); await page.goto('/app/site');
    const mgr = page.getByTestId('pages-manager'); await mgr.getByRole('button', { name: /add page|إضافة صفحة/i }).click();
    const card = mgr.getByTestId('page-card').first(); await card.getByLabel(/page title|عنوان الصفحة/i).fill('Our Story'); await expect(card.getByLabel(/url slug|عنوان الرابط/i)).toHaveValue('our-story');
    await card.getByLabel(/seo title|عنوان SEO/i).fill('Our Story | Builder'); await card.getByLabel(/seo description|وصف SEO/i).fill('How we started');
    await card.getByLabel(/message|الرسالة|النص/i).first().fill('We started in a small garage.');
    // duplicate + reserved + format are rejected in the UI before anything is saved
    await mgr.getByRole('button', { name: /add page|إضافة صفحة/i }).click(); const c2 = mgr.getByTestId('page-card').nth(1);
    await c2.getByLabel(/url slug|عنوان الرابط/i).fill('our-story'); await expect(c2.getByRole('alert')).toBeVisible();
    await page.getByRole('button', { name: /^(save|حفظ)$/i }).click(); await expect(page.getByRole('alert').first()).toContainText(/duplicate|مكرر/i);
    await c2.getByLabel(/url slug|عنوان الرابط/i).fill('portal'); await expect(c2.getByRole('alert')).toContainText(/reserved|محجوز/i);
    await c2.getByLabel(/url slug|عنوان الرابط/i).fill('Bad Slug!'); await expect(c2.getByRole('alert')).toBeVisible();
    await c2.getByRole('button', { name: /delete page|حذف الصفحة/i }).click();
    // the API enforces the same rules (a client cannot bypass the UI)
    const cur = (await (await o.api.get('/api/v1/tenant/site')).json()).data; const base = { templateKey: cur.templateKey, brand: cur.draft.brand, sections: cur.draft.sections };
    const mk = (slug: string) => ({ slug, title: 'X', enabled: true, seo: {}, sections: [] });
    expect((await o.api.put('/api/v1/tenant/site', { data: { ...base, pages: [mk('same'), mk('same')] }, headers: o.h })).status()).toBe(400);
    expect((await o.api.put('/api/v1/tenant/site', { data: { ...base, pages: [mk('portal')] }, headers: o.h })).status()).toBe(400);
    expect((await o.api.put('/api/v1/tenant/site', { data: { ...base, pages: [mk('Has Space')] }, headers: o.h })).status()).toBe(400);
    await page.getByRole('button', { name: /^(publish|نشر)$/i }).click(); await expect(page.getByRole('alert').first()).toBeVisible();
    // published page routes, SEO title/description, menu link, 404 for unknown / disabled
    const r = await page.goto(`/sites/${o.slug}/our-story`); expect(r!.status()).toBe(200);
    await expect(page).toHaveTitle('Our Story | Builder'); await expect(page.getByRole('heading', { level: 1 })).toHaveText('Our Story'); await expect(page.getByText('We started in a small garage.')).toBeVisible();
    expect(await page.locator('meta[name="description"]').getAttribute('content')).toBe('How we started');
    await page.goto(`/sites/${o.slug}`); await expect(page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'Our Story' })).toHaveAttribute('href', `/sites/${o.slug}/our-story`);
    expect((await page.goto(`/sites/${o.slug}/no-such-page`))!.status()).toBe(404);
    await page.goto('/app/site'); await mgr.getByTestId('page-card').first().getByLabel(/enabled|منشورة/i).uncheck(); await page.getByRole('button', { name: /^(publish|نشر)$/i }).click(); await expect(page.getByRole('alert').first()).toBeVisible();
    expect((await page.goto(`/sites/${o.slug}/our-story`))!.status()).toBe(404);
  });

  test('image cropping: choose, adjust, preview, save the cropped file, show it on the published site', async ({ browser }) => {
    const o = await owner(browser); const page = await o.ctx.newPage(); await page.goto('/app/site');
    await page.getByLabel(/upload logo|رفع شعار/i).setInputFiles({ name: 'wide.png', mimeType: 'image/png', buffer: png(400, 200) });
    const dlg = page.getByRole('dialog'); await expect(dlg).toBeVisible(); const preview = dlg.getByTestId('crop-preview');
    await expect(preview).toHaveJSProperty('width', 360); await expect(preview).toHaveJSProperty('height', 360); // 1:1 by default
    const px = () => preview.evaluate((c: HTMLCanvasElement) => { const d = c.getContext('2d')!.getImageData(10, 180, 1, 1).data; return [d[0], d[1], d[2]]; });
    expect((await px())[0]).toBeGreaterThan(150);                                                      // centred crop of a 2:1 image starts inside the red half
    await dlg.getByLabel(/pan horizontally|تحريك أفقي/i).fill('1'); expect((await px())[2]).toBeGreaterThan(150); // panning to the right shows the blue half
    await dlg.getByLabel(/aspect ratio|نسبة/i).selectOption({ label: '16:9' }); await expect(preview).toHaveJSProperty('height', 203);
    await dlg.getByLabel(/aspect ratio|نسبة/i).selectOption({ label: '1:1' }); await dlg.getByLabel(/zoom|تكبير/i).fill('2');
    await dlg.getByRole('button', { name: /save cropped|حفظ الصورة/i }).click(); await expect(dlg).toHaveCount(0);
    await expect(page.getByRole('alert').first()).toContainText(/logo|الشعار/i);
    await page.getByRole('button', { name: /^(publish|نشر)$/i }).click(); await expect(page.getByRole('alert').first()).toContainText(/published|نشر/i);
    const logo = (await (await o.api.get('/api/v1/tenant/site')).json()).data.draft.brand.logoUrl as string; expect(logo).toMatch(/\.(png|jpg)$|\/files\//);
    await page.goto(`/sites/${o.slug}`); const img = page.locator('img.logo-img').first(); await expect(img).toBeVisible();
    const dim = await img.evaluate((i: HTMLImageElement) => ({ w: i.naturalWidth, h: i.naturalHeight })); expect(dim.w).toBeGreaterThan(0); expect(dim.w).toBe(dim.h); // the stored image is the square crop, not the 2:1 original
    // Escape cancels without uploading
    await page.goto('/app/site'); await page.getByLabel(/upload logo|رفع شعار/i).setInputFiles({ name: 'w.png', mimeType: 'image/png', buffer: png(400, 200) }); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
