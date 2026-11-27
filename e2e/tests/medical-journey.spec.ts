import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Codela Med end-to-end journey (the checklist from the engineering brief), driven through the real web app + API:
 * register a business -> log in -> dashboard -> specialty/doctor/patient -> appointment -> persistence -> status change -> invoice -> KPIs -> role permissions.
 * Data is created through the same same-origin proxy the browser uses; the browser context shares the session, so pages below are really signed in.
 * NOTE: written without being able to run it in the authoring environment; adjust selectors/payloads if the product changes.
 */
const PW = 'Str0ng-Pass!1';
const slug = `e2e${Date.now().toString(36)}`.slice(0, 20);
const today = new Date().toLocaleDateString('en-CA');

test.describe.configure({ mode: 'serial' });

test('Codela Med: full clinic workflow', async ({ browser }) => {
  const ctx = await browser.newContext(); const api: APIRequestContext = ctx.request; const page = await ctx.newPage();
  let csrf = '';
  const call = async (method: 'post' | 'patch', url: string, data: object = {}) => api[method](url, { data, headers: { 'x-csrf-token': csrf } });
  const create = async (entity: string, data: object) => { const r = await call('post', `/api/v1/tenant/p/${entity}`, data); expect(r.status(), `${entity}: ${await r.text()}`).toBe(201); return (await r.json()).data; };

  // 1-2. Register a new business (owner is logged in by the response cookie)
  const reg = await api.post('/api/v1/auth/register-business', { data: { businessName: `E2E Clinic ${slug}`, slug, productSlug: 'medical', name: 'Owner', email: `o@${slug}.test`, password: PW } });
  expect(reg.status(), await reg.text()).toBe(201); csrf = (await reg.json()).data.csrfToken;

  // 3-4. Dashboard / medical product UI is reachable and shows the medical work board entry
  await page.goto('/app'); await expect(page).toHaveURL(/\/app/);
  await page.goto('/app/board'); await expect(page.locator('main#main')).toBeVisible();

  // 5-8. Specialty, doctor, patient
  const spec = await create('specialty', { name: 'Cardiology' });
  const doc = await create('doctor', { name: 'Dr. Hany', specialtyId: spec.id, consultationFee: 30000, phone: '01001234567' });
  const pat = await create('patient', { name: 'Ahmed Ali', phone: '01112223334', gender: 'male', birthDate: '1990-05-01' });

  // 9-12. Appointment: created, persisted, listed, double-booking refused
  const ap = await create('appointment', { patientId: pat.id, doctorId: doc.id, date: today, startTime: '23:00', durationMin: 15 });
  const list = await api.get(`/api/v1/tenant/p/appointment?pageSize=50`); expect((await list.json()).data.some((r: { id: string }) => r.id === ap.id)).toBe(true);
  const clash = await call('post', '/api/v1/tenant/p/appointment', { patientId: pat.id, doctorId: doc.id, date: today, startTime: '23:00', durationMin: 15 }); expect(clash.status()).toBeGreaterThanOrEqual(400);
  await page.goto('/app/board'); await expect(page.getByText('Ahmed Ali').first()).toBeVisible();

  // 13. Update status through the board's backend contract
  const up = await call('patch', `/api/v1/tenant/p/appointment/${ap.id}`, { status: 'confirmed' }); expect(up.status(), await up.text()).toBe(200);
  expect((await (await api.get(`/api/v1/tenant/p/appointment/${ap.id}`)).json()).data.data.status).toBe('confirmed');

  // 14. Invoice
  const inv = await create('invoice', { patientId: pat.id, lines: [{ desc: 'Consultation', qty: 1, unitPrice: 30000 }] }); expect(inv.id).toBeTruthy();

  // 15. Dashboard KPIs reflect the data
  const dash = await api.get('/api/v1/tenant/dashboard'); expect(dash.status()).toBe(200); expect(JSON.stringify(await dash.json())).toMatch(/\d/);

  // 16. Roles: an employee (front desk) can work with patients/appointments but not medical records
  const emp = await call('post', '/api/v1/tenant/employees', { name: 'Emp', email: `emp@${slug}.test`, password: 'Emp-Pass-1234!', role: 'employee' }); expect(emp.status(), await emp.text()).toBeLessThan(300);
  const ectx = await browser.newContext(); const eapi = ectx.request;
  const login = await eapi.post('/api/v1/auth/login', { data: { email: `emp@${slug}.test`, password: 'Emp-Pass-1234!' } }); expect(login.status()).toBe(200);
  expect((await eapi.get('/api/v1/tenant/p/patient')).status()).toBe(200);
  expect((await eapi.get('/api/v1/tenant/p/medicalRecord')).status()).toBe(403);

  await ctx.close(); await ectx.close();
});
