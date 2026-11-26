import { expect, test } from '@playwright/test';

/** The UI shows Arabic-Indic digits and separators in Arabic; compare on plain digits. */
const plain = (x: string) => x.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[٬,]/g, '').replace(/٫/g, '.');
const hasNum = async (loc: import('@playwright/test').Locator, ...nums: string[]) => { for (const n of nums) await expect.poll(async () => plain(await loc.innerText())).toContain(n); };
const lacksNum = async (loc: import('@playwright/test').Locator, n: string) => expect.poll(async () => plain(await loc.innerText())).not.toContain(n);
const PW = 'Str0ng-Pass!1'; const uid = () => `qt${Math.random().toString(36).slice(2, 8)}`;

test('Business quotations: create, edit, status flow, locking, statistics, search, tenant isolation', async ({ browser }) => {
  const slug = uid(); const ctx = await browser.newContext(); const api = ctx.request;
  const r = await api.post('/api/v1/auth/register-business', { data: { businessName: `Biz ${slug}`, slug, productSlug: 'business', name: 'Owner', email: `o@${slug}.test`, password: PW } });
  expect(r.status(), await r.text()).toBe(201); const h = { 'x-csrf-token': (await r.json()).data.csrfToken as string };
  const cu = await api.post('/api/v1/tenant/p/customer', { data: { name: 'Acme Trading' }, headers: h }); expect(cu.status(), await cu.text()).toBe(201);
  const page = await ctx.newPage(); await page.goto('/app/quotations'); await expect(page.getByRole('heading', { name: /quotations|عروض الأسعار/i })).toBeVisible();
  await page.getByRole('button', { name: /new quotation|عرض سعر جديد/i }).first().click();
  const form = page.getByRole('region', { name: /new quotation|عرض سعر جديد/i });
  await form.getByLabel(/^customer|^العميل/i).selectOption({ label: 'Acme Trading' }); await form.getByLabel(/^title|عنوان العرض/i).fill('Office fit-out');
  await form.getByLabel(/^(description|البند) 1$/i).fill('Desks'); await form.getByLabel(/^(qty|الكمية) 1$/i).fill('4'); await form.getByLabel(/^(unit price|سعر الوحدة) 1$/i).fill('1500');
  await form.getByRole('button', { name: /add line|^\+ بند/i }).click(); await form.getByLabel(/^(description|البند) 2$/i).fill('Chairs'); await form.getByLabel(/^(qty|الكمية) 2$/i).fill('10'); await form.getByLabel(/^(unit price|سعر الوحدة) 2$/i).fill('200');
  await form.getByLabel(/^discount|^الخصم/i).fill('500'); await form.getByLabel(/tax %|ضريبة/i).fill('14');
  // live totals: subtotal 4*1500 + 10*200 = 8000; discount 500; tax 14% of 7500 = 1050; total 8550
  const totals = form.getByTestId('form-totals'); await hasNum(totals, '8000.00', '1050.00', '8550.00');
  // server rule: a discount above the subtotal is refused and shown
  await form.getByLabel(/^discount|^الخصم/i).fill('99999'); await form.getByRole('button', { name: /^(save|حفظ)$/i }).click(); await expect(page.getByRole('alert').first()).toContainText(/discount|الخصم/i);
  await form.getByLabel(/^discount|^الخصم/i).fill('500'); await form.getByRole('button', { name: /^(save|حفظ)$/i }).click();
  const row = page.getByTestId('quotation-row').filter({ hasText: 'Office fit-out' }); await expect(row).toBeVisible(); await hasNum(row, '8550'); await expect(row).toContainText(/draft|مسودة/i); await expect(row).toContainText('Acme Trading');
  // edit while draft
  await row.getByRole('button', { name: /^(edit|تعديل)$/i }).click(); const ed = page.getByRole('region', { name: /edit quotation|تعديل عرض/i }); await ed.getByLabel(/^(qty|الكمية) 2$/i).fill('20');
  await ed.getByRole('button', { name: /^(save|حفظ)$/i }).click(); await hasNum(row, '10830'); await lacksNum(row, '8550'); // 10,000 - 500 + 14% of 9,500
  // status flow: draft -> sent (then the lines are locked: no Edit button, and the API refuses a line change)
  await row.getByRole('button', { name: /^(send|إرسال)$/i }).click(); await expect(row).toContainText(/sent|مُرسل/i); await expect(row.getByRole('button', { name: /^(edit|تعديل)$/i })).toHaveCount(0);
  const qid = (await (await api.get('/api/v1/tenant/p/quotation?pageSize=5')).json()).data[0].id as string;
  const locked = await api.patch(`/api/v1/tenant/p/quotation/${qid}`, { data: { lines: [{ description: 'x', qty: 1, unitPrice: 1 }] }, headers: h }); expect(locked.status()).toBe(409);
  // a second quotation, rejected straight from draft; statistics follow
  await page.getByRole('button', { name: /new quotation|عرض سعر جديد/i }).first().click(); const f2 = page.getByRole('region', { name: /new quotation|عرض سعر جديد/i });
  await f2.getByLabel(/^customer|^العميل/i).selectOption({ label: 'Acme Trading' }); await f2.getByLabel(/^title|عنوان العرض/i).fill('Small order'); await f2.getByLabel(/^(description|البند) 1$/i).fill('Cables'); await f2.getByLabel(/^(unit price|سعر الوحدة) 1$/i).fill('300');
  await f2.getByRole('button', { name: /^(save|حفظ)$/i }).click(); const row2 = page.getByTestId('quotation-row').filter({ hasText: 'Small order' }); await expect(row2).toBeVisible();
  await expect(page.getByTestId('kpi-open')).toHaveText('2'); await expect(page.getByTestId('kpi-rate')).toHaveText('—');   // nothing decided yet
  await row2.getByRole('button', { name: /^(reject|رفض)$/i }).click(); await expect(row2).toContainText(/rejected|مرفوض/i); await expect(row2.getByRole('button', { name: /^(send|إرسال|accept|قبول)$/i })).toHaveCount(0); // terminal
  await row.getByRole('button', { name: /^(accept|قبول)$/i }).click(); await expect(page.getByTestId('kpi-rate')).toHaveText('50%'); await expect(page.getByTestId('kpi-open')).toHaveText('0');
  // filter + search
  await page.getByRole('button', { name: /^(accepted|مقبول)/i }).click(); await expect(page.getByTestId('quotation-row')).toHaveCount(1); await page.getByRole('button', { name: /^(all|الكل)/i }).click();
  await page.getByPlaceholder(/code, title|الرقم أو العنوان/i).fill('small'); await expect(page.getByTestId('quotation-row')).toHaveCount(1); await page.getByPlaceholder(/code, title|الرقم أو العنوان/i).fill('');
  // details / print view shows the real figures
  await row.getByRole('button', { name: /^(view|عرض)$/i }).click(); const det = page.getByRole('region', { name: /quotation details|تفاصيل/i }); await expect(det).toContainText('Desks'); await hasNum(det, '10830'); await expect(det).toContainText('Acme Trading');
  // another business never sees it
  const other = await browser.newContext(); const s2 = uid(); const r2 = await other.request.post('/api/v1/auth/register-business', { data: { businessName: `Other ${s2}`, slug: s2, productSlug: 'business', name: 'Owner', email: `o@${s2}.test`, password: PW } }); expect(r2.status()).toBe(201);
  expect((await (await other.request.get('/api/v1/tenant/p/quotation')).json()).meta.total).toBe(0); expect((await other.request.get(`/api/v1/tenant/p/quotation/${qid}`)).status()).toBe(404);
});
