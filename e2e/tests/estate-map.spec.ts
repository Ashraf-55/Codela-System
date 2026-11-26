import { expect, test } from '@playwright/test';

const PW = 'Str0ng-Pass!1'; const uid = () => `em${Math.random().toString(36).slice(2, 9)}`;

test('Estate: map plots only listings with real coordinates, rejects bad ones, links to each property URL', async ({ browser }) => {
  const slug = uid(); const ctx = await browser.newContext(); const api = ctx.request;
  const r = await api.post('/api/v1/auth/register-business', { data: { businessName: `Estate ${slug}`, slug, productSlug: 'realestate', name: 'Owner', email: `o@${slug}.test`, password: PW } });
  expect(r.status(), await r.text()).toBe(201); const h = { 'x-csrf-token': (await r.json()).data.csrfToken as string };
  const mk = async (entity: string, data: object) => { const x = await api.post(`/api/v1/tenant/p/${entity}`, { data, headers: h }); expect(x.status(), await x.text()).toBe(201); return (await x.json()).data.id as string; };
  const loc = await mk('location', { name: 'New Cairo' }); const typ = await mk('propertyType', { name: 'Apartment' });
  const base = { purpose: 'sale', typeId: typ, locationId: loc, price: 250000000 };
  const a = await mk('property', { ...base, title: 'Alpha flat with coordinates', lat: '30.0300', lng: '31.4700' });
  const b = await mk('property', { ...base, title: 'Bravo flat with coordinates', lat: '30.0600', lng: '31.2300' });
  await mk('property', { ...base, title: 'Flat without location' });
  const bad = (d: object) => api.post('/api/v1/tenant/p/property', { data: { ...base, title: 'bad', ...d }, headers: h });
  expect((await bad({ lat: '95', lng: '31' })).status()).toBe(400);        // latitude out of range
  expect((await bad({ lat: '30', lng: '181' })).status()).toBe(400);       // longitude out of range
  expect((await bad({ lat: '30' })).status()).toBe(400);                   // both or neither
  expect((await bad({ lat: 'abc', lng: 'def' })).status()).toBe(400);      // not numbers
  expect((await api.post('/api/v1/tenant/site/publish', { data: {}, headers: h })).status()).toBe(200);

  const page = await ctx.newPage(); await page.goto(`/sites/${slug}`);
  await page.getByRole('button', { name: /^(map|خريطة)$/i }).click();
  await expect(page.getByTestId('estate-map')).toBeVisible();
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(2);        // the listing without coordinates is NOT plotted
  await expect(page.getByTestId('map-status')).toContainText(/2 listings on the map.*1 without a location|2 عقار على الخريطة/);
  await page.locator('.leaflet-marker-icon').first().click();
  const link = page.locator('.leaflet-popup-content a'); await expect(link).toBeVisible();
  const href = await link.getAttribute('href'); expect(href).toMatch(new RegExp(`^/sites/${slug}/properties/(${a}|${b})$`));
  await link.click(); await expect(page).toHaveURL(new RegExp(`/properties/(${a}|${b})$`)); await expect(page.getByRole('heading', { level: 1 })).toContainText('flat with coordinates'); // shareable URL of the property
  // filters apply to the map as well
  await page.goto(`/sites/${slug}`); await page.getByRole('button', { name: /^(map|خريطة)$/i }).click(); await page.getByLabel(/keyword|بحث بالكلمة/i).fill('Alpha');
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(1);
  await page.getByRole('button', { name: /^(list|قائمة)$/i }).click(); await expect(page.getByText('Alpha flat with coordinates').first()).toBeVisible();
});
