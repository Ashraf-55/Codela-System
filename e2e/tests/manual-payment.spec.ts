import { expect, test } from '@playwright/test';

/**
 * Manual payment journey in a real browser: configure InstaPay -> a new business submits a receipt on /app/billing
 * -> Super Admin approves on /admin/payments -> the subscription becomes active.
 * Needs a Super Admin: create one first (npm run create-admin) and export E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD.
 * Written without being able to run it in the authoring environment; treat the first run as calibration.
 */
const PW = 'Str0ng-Pass!1';
const slug = `mp${Date.now().toString(36)}`.slice(0, 20);
const adminEmail = process.env.E2E_ADMIN_EMAIL; const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`e2e-receipt-${slug}`.padEnd(80, 'x'))]);

test('manual payment: submit receipt, staff approves, subscription becomes active', async ({ browser }) => {
  test.skip(!adminEmail || !adminPassword, 'set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD (npm run create-admin)');

  // Super Admin session (cookies are shared by this context's request and page)
  const actx = await browser.newContext(); const admin = await actx.newPage();
  const login = await actx.request.post('/api/v1/platform/auth/login', { data: { email: adminEmail, password: adminPassword } });
  expect(login.status(), await login.text()).toBe(200); const acsrf = (await login.json()).data.csrfToken as string;
  const cfg = await actx.request.put('/api/v1/platform/settings/payment', { headers: { 'x-csrf-token': acsrf }, data: { value: { instapay: { enabled: true, handle: 'e2e@instapay', accountName: 'E2E Co' }, vodafone_cash: { enabled: false, number: '' } } } });
  expect(cfg.status(), await cfg.text()).toBe(200);

  // New business (owner session)
  const tctx = await browser.newContext(); const tenant = await tctx.newPage();
  const reg = await tctx.request.post('/api/v1/auth/register-business', { data: { businessName: `E2E Pay ${slug}`, slug, productSlug: 'medical', name: 'Owner', email: `o@${slug}.test`, password: PW } });
  expect(reg.status(), await reg.text()).toBe(201);

  // Tenant: the panel shows the configured method, the receipt is uploaded and the request is pending
  await tenant.goto('/app/billing');
  await expect(tenant.getByText('e2e@instapay')).toBeVisible();
  await tenant.getByTestId('mp-reference').fill(`E2E-${slug}`);
  await tenant.getByTestId('mp-receipt').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG });
  await tenant.getByTestId('mp-submit').click();
  await expect(tenant.getByTestId('mp-status').first()).toContainText(/Pending review|قيد المراجعة/);
  const before = await (await tctx.request.get('/api/v1/tenant/subscription')).json();
  expect(before.data.status).not.toBe('active'); // a receipt alone never activates

  // Super Admin: find the request, type the amount seen on the receipt, approve
  const list = await (await tctx.request.get('/api/v1/tenant/subscription/manual-payments')).json();
  const row = list.data[0] as { amount: number };
  await admin.goto('/admin/payments');
  await expect(admin.getByText(`E2E Pay ${slug}`)).toBeVisible();
  await admin.getByText(`E2E Pay ${slug}`).locator('xpath=ancestor::section[1]').getByTestId('review-amount').fill((row.amount / 100).toFixed(2));
  await admin.getByText(`E2E Pay ${slug}`).locator('xpath=ancestor::section[1]').getByTestId('review-approve').click();
  await expect(admin.getByText(`E2E Pay ${slug}`)).toBeHidden({ timeout: 10_000 }); // leaves the "pending" list

  // Tenant: approved and active
  await tenant.reload();
  await expect(tenant.getByTestId('mp-status').first()).toContainText(/Approved|تمت الموافقة/);
  const after = await (await tctx.request.get('/api/v1/tenant/subscription')).json();
  expect(after.data.status).toBe('active');
  await actx.close(); await tctx.close();
});
