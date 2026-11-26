import { expect, test } from '@playwright/test';

const PW = 'Str0ng-Pass!1'; const uid = () => `lp${Math.random().toString(36).slice(2, 8)}`;
const plain = (x: string) => x.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace('٪', '%');

test('Estate lead performance screen shows real totals, per-source and per-broker win rates', async ({ browser }) => {
  const slug = uid(); const ctx = await browser.newContext(); const api = ctx.request;
  const r = await api.post('/api/v1/auth/register-business', { data: { businessName: `Est ${slug}`, slug, productSlug: 'realestate', name: 'Owner', email: `o@${slug}.test`, password: PW } });
  expect(r.status(), await r.text()).toBe(201); const h = { 'x-csrf-token': (await r.json()).data.csrfToken as string };
  const mk = async (e: string, data: object) => { const x = await api.post(`/api/v1/tenant/p/${e}`, { data, headers: h }); expect(x.status(), await x.text()).toBe(201); return (await x.json()).data.id as string; };
  const b1 = await mk('broker', { name: 'Hossam' }); const b2 = await mk('broker', { name: 'Mona' });
  const lead = async (name: string, source: string, brokerId?: string, stage?: string) => { const id = await mk('lead', { name, source, brokerId }); if (stage) expect((await api.patch(`/api/v1/tenant/p/lead/${id}`, { data: { stage }, headers: h })).status()).toBe(200); };
  await lead('A', 'website', b1, 'won'); await lead('B', 'website', b1, 'lost'); await lead('C', 'referral', b1); await lead('D', 'website', b2, 'won'); await lead('E', 'call');
  const page = await ctx.newPage(); await page.goto('/app/lead-performance');
  await expect(page.getByTestId('lp-total')).toHaveText(/^[5٥]$/); await expect(page.getByTestId('lp-won')).toHaveText(/^[2٢]$/); expect(plain(await page.getByTestId('lp-rate').innerText())).toBe('67%'); // 2 won / (2 won + 1 lost)
  const hossam = page.getByTestId('lp-broker').getByRole('row').filter({ hasText: 'Hossam' }); expect(plain(await hossam.innerText())).toMatch(/3\s+1\s+1\s+1\s+50%/);   // total 3, open 1, won 1, lost 1
  await expect(page.getByTestId('lp-source').getByRole('row')).toHaveCount(4);                                                                                     // header + website, referral, call
});
