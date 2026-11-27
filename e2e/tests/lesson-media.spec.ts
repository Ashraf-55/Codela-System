import { expect, test } from '@playwright/test';

const PW = 'Str0ng-Pass!1'; const uid = () => `lm${Math.random().toString(36).slice(2, 8)}`;
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(8), Buffer.alloc(2048, 7)]);

test('Learn: owner uploads a lesson video + material in the course builder; a paid student streams and downloads them in the portal', async ({ browser }) => {
  const slug = uid(); const ctx = await browser.newContext(); const api = ctx.request;
  const r = await api.post('/api/v1/auth/register-business', { data: { businessName: `Learn ${slug}`, slug, productSlug: 'learning', name: 'Owner', email: `o@${slug}.test`, password: PW } });
  expect(r.status(), await r.text()).toBe(201); const h = { 'x-csrf-token': (await r.json()).data.csrfToken as string };
  const mk = async (e: string, data: object) => { const x = await api.post(`/api/v1/tenant/p/${e}`, { data, headers: h }); expect(x.status(), await x.text()).toBe(201); return (await x.json()).data.id as string; };
  const ins = await mk('instructor', { name: 'Dr X' }); const course = await mk('course', { title: 'Hosted media', instructorId: ins, price: 5000 });
  await mk('lesson', { courseId: course, title: 'Intro video', position: 1, kind: 'video' }); await mk('lesson', { courseId: course, title: 'Course notes', position: 2, kind: 'file' });
  expect((await api.patch(`/api/v1/tenant/p/course/${course}`, { data: { status: 'published' }, headers: h })).status()).toBe(200);
  expect((await api.post('/api/v1/tenant/site/publish', { data: {}, headers: h })).status()).toBe(200);

  const page = await ctx.newPage(); await page.goto('/app/course-builder'); await page.getByRole('main').getByRole('combobox').first().selectOption(course); // scoped: the header search box is a combobox too
  const rows = page.locator('tbody tr').filter({ hasText: 'Intro video' }); await expect(rows).toBeVisible();
  await rows.locator('input[type=file]').setInputFiles({ name: 'intro.mp4', mimeType: 'video/mp4', buffer: MP4 });
  await expect(rows.getByTestId('lesson-file-attached')).toBeVisible();
  await page.locator('tbody tr').filter({ hasText: 'Course notes' }).locator('input[type=file]').setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n%notes\n') });
  await expect(page.locator('tbody tr').filter({ hasText: 'Course notes' }).getByTestId('lesson-file-attached')).toBeVisible();
  // a 12 MB video (above the 10 MB default body limit of the web proxy) must upload completely
  const big = Buffer.concat([MP4, Buffer.alloc(12 * 1024 * 1024, 9)]); await rows.locator('input[type=file]').setInputFiles({ name: 'big.mp4', mimeType: 'video/mp4', buffer: big });
  await expect(page.getByRole('alert').filter({ hasText: /uploaded|تم رفع/i }).first()).toBeVisible();
  const files = await api.get('/api/v1/tenant/files'); void files;
  await rows.locator('input[type=file]').setInputFiles({ name: 'fake.mp4', mimeType: 'video/mp4', buffer: Buffer.from('<html>not a video</html>'.repeat(10)) });
  await expect(page.getByRole('alert').filter({ hasText: /MP4|WebM|type|نوع/i }).first()).toBeVisible();   // a disguised file is refused, with a visible error

  // student
  const sctx = await browser.newContext(); const email = `s@${slug}.test`;
  const reg = await sctx.request.post(`/api/v1/public/portal/register?site=${slug}`, { data: { name: 'Sara', email, password: PW } }); expect(reg.status(), await reg.text()).toBe(201);
  const st = await mk('student', { name: 'Sara', email }); const enr = await mk('enrollment', { studentId: st, courseId: course });
  const sp = await sctx.newPage(); await sp.goto(`/sites/${slug}/portal`);
  const locked = await sctx.request.get(`/api/v1/public/portal/learning/enrollments/${enr}?site=${slug}`); expect(locked.status()).toBe(200);
  const lessons = (await locked.json()).data.lessons as { id: string; title: string }[]; const vid = lessons.find((l) => l.title === 'Intro video')!;
  expect((await sctx.request.get(`/api/v1/public/portal/learning/enrollments/${enr}/lessons/${vid.id}/file?site=${slug}`)).status()).toBe(409);   // unpaid: no stream
  expect((await api.post('/api/v1/tenant/p/payment', { data: { enrollmentId: enr, amount: 5000, method: 'cash' }, headers: h })).status()).toBe(201);
  const ok = await sctx.request.get(`/api/v1/public/portal/learning/enrollments/${enr}/lessons/${vid.id}/file?site=${slug}`, { headers: { range: 'bytes=0-99' } });
  expect(ok.status()).toBe(206); expect((await ok.body()).length).toBe(100); expect(ok.headers()['content-range']).toMatch(/^bytes 0-99\/\d+$/);
  const sizeOk = Number(ok.headers()['content-range'].split('/')[1]); expect(sizeOk).toBe(MP4.length + 12 * 1024 * 1024); // the whole 12 MB arrived on the server
  await sp.reload(); await sp.getByRole('button', { name: /Intro video/ }).click();
  await expect(sp.locator('video')).toHaveAttribute('src', new RegExp(`/lessons/${vid.id}/file`));
  await sp.getByRole('button', { name: /Course notes/ }).click(); await expect(sp.getByTestId('lesson-download')).toContainText('notes.pdf');
  const dl = await sctx.request.get(await sp.getByTestId('lesson-download').getAttribute('href') as string); expect(dl.status()).toBe(200); expect(dl.headers()['content-disposition']).toMatch(/^attachment/);
});
