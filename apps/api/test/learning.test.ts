import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { setup, tenantClient, employeeAgent, type TC } from './_helpers';

let ctx: ReturnType<typeof setup>;
beforeEach(() => { ctx = setup(); });
const academy = (slug = 'alpha') => tenantClient(ctx.app, slug, 'learning');
const host = (slug = 'alpha') => `${slug}.codela.test`;

async function seed(a: TC, publish = true) {
  const cat = (await a.create('category', { name: 'Programming' })).body.data;
  const ins = (await a.create('instructor', { name: 'Dr. Salma', bio: 'Expert', email: 's@x.test' })).body.data;
  const course = (await a.create('course', { title: 'Intro to Python', categoryId: cat.id, instructorId: ins.id, price: 50000, level: 'beginner', capacity: 2, description: 'Learn' })).body.data;
  const l1 = (await a.create('lesson', { courseId: course.id, title: 'Variables', position: 1, durationMin: 20, isPreview: true })).body.data;
  const l2 = (await a.create('lesson', { courseId: course.id, title: 'Loops', position: 2, durationMin: 25 })).body.data;
  const exam = (await a.create('exam', { courseId: course.id, title: 'Final', passScore: 60, maxAttempts: 2 })).body.data;
  const q1 = (await a.create('question', { examId: exam.id, text: '2+2?', options: [{ text: '3' }, { text: '4' }], correctIndex: 1, points: 1 })).body.data;
  const q2 = (await a.create('question', { examId: exam.id, text: 'Python is?', options: [{ text: 'Language' }, { text: 'Snake only' }], correctIndex: 0, points: 1 })).body.data;
  const student = (await a.create('student', { name: 'Ali Student', email: 'ali@x.test', phone: '01001234567' })).body.data;
  if (publish) await a.patch('course', course.id, { status: 'published' });
  return { cat, ins, course, l1, l2, exam, q1, q2, student };
}
const enrol = (a: TC, x: Awaited<ReturnType<typeof seed>>, over: object = {}) => a.create('enrollment', { studentId: x.student.id, courseId: x.course.id, ...over });
async function paidEnrollment(a: TC, x: Awaited<ReturnType<typeof seed>>) {
  const e = (await enrol(a, x)).body.data; await a.create('payment', { enrollmentId: e.id, amount: 50000, method: 'cash' }); return e;
}

describe('catalogue & publishing', () => {
  it('publishing needs lessons; lesson positions unique; delete restricted', async () => {
    const a = await academy(); const x = await seed(a, false); const empty = (await a.create('course', { title: 'Empty', instructorId: x.ins.id, price: 0 })).body.data;
    expect((await a.patch('course', empty.id, { status: 'published' })).body.error.code).toBe('NO_LESSONS');
    expect((await a.patch('course', x.course.id, { status: 'published' })).status).toBe(200);
    expect((await a.create('lesson', { courseId: x.course.id, title: 'Dup', position: 1 })).status).toBe(409);
    expect((await a.del('course', x.course.id)).body.error.code).toBe('IN_USE');
    expect((await a.create('question', { examId: x.exam.id, text: 'x', options: [{ text: 'only one' }], correctIndex: 0 })).status).toBe(400);
    expect((await a.create('question', { examId: x.exam.id, text: 'x', options: [{ text: 'a' }, { text: 'b' }], correctIndex: 5 })).status).toBe(400);
  });
  it('public catalogue: published courses with filters, instructors, course detail without private fields', async () => {
    const a = await academy(); const x = await seed(a); await a.create('course', { title: 'Draft Course', instructorId: x.ins.id, price: 1 });
    const get = (p: string, h = host()) => request(ctx.app).get(`/api/v1/public/${p}`).set('Host', h);
    expect((await get('catalog/course')).body.data.map((c: { title: string }) => c.title)).toEqual(['Intro to Python']);
    expect((await get(`catalog/course?categoryId=${x.cat.id}&price_to=60000&level=beginner`)).body.meta.total).toBe(1); expect((await get('catalog/course?price_from=60000')).body.meta.total).toBe(0);
    expect((await get('catalog/instructor')).body.data[0].name).toBe('Dr. Salma'); expect(JSON.stringify((await get('catalog/instructor')).body)).not.toMatch(/email|phone|tenantId/);
    const d = await get(`actions/course?id=${x.course.id}`); expect(d.status).toBe(200); expect(d.body.data.lessons.map((l: { title: string }) => l.title)).toEqual(['Variables', 'Loops']);
    expect(JSON.stringify(d.body)).not.toMatch(/contentUrl|tenantId|body"/); expect((await get(`actions/course?id=${x.q1.id}`)).status).toBe(404);
    const draft = (await a.list('course', '?status=draft')).body.data[0]; expect((await get(`actions/course?id=${draft.id}`)).status).toBe(404);
    expect((await get('catalog/student')).status).toBe(404); expect((await get('catalog/question')).status).toBe(404);
  });
});

describe('enrollment & payments', () => {
  it('only published courses; unique pair; capacity; price snapshot', async () => {
    const a = await academy(); const x = await seed(a, false);
    expect((await enrol(a, x)).body.error.code).toBe('NOT_PUBLISHED'); await a.patch('course', x.course.id, { status: 'published' });
    const e = await enrol(a, x); expect(e.status).toBe(201); expect(e.body.data.data).toMatchObject({ price: 50000, paymentStatus: 'unpaid', progressPct: 0, status: 'active' }); expect(e.body.data.code).toBe('EN-0001');
    expect((await enrol(a, x)).status).toBe(409);
    const s2 = (await a.create('student', { name: 'Two', email: 't@x.test' })).body.data; const s3 = (await a.create('student', { name: 'Three', email: 'th@x.test' })).body.data;
    expect((await enrol(a, x, { studentId: s2.id })).status).toBe(201); expect((await enrol(a, x, { studentId: s3.id })).body.error.code).toBe('COURSE_FULL');
    await a.patch('course', x.course.id, { price: 99999 }); expect((await a.get('enrollment', e.body.data.id)).body.data.data.price).toBe(50000);
    expect((await a.create('student', { name: 'Dup', email: 'ALI@x.test' })).status).toBe(409);
  });
  it('payments: no overpay, partial then paid; free courses are paid immediately', async () => {
    const a = await academy(); const x = await seed(a); const e = (await enrol(a, x)).body.data;
    expect((await a.create('payment', { enrollmentId: e.id, amount: 50001, method: 'card' })).body.error.code).toBe('OVERPAYMENT');
    await a.create('payment', { enrollmentId: e.id, amount: 20000, method: 'card' }); let cur = (await a.get('enrollment', e.id)).body.data.data; expect(cur.paidAmount).toBe(20000); expect(cur.paymentStatus).toBe('unpaid');
    await a.create('payment', { enrollmentId: e.id, amount: 30000, method: 'cash' }); cur = (await a.get('enrollment', e.id)).body.data.data; expect(cur.paymentStatus).toBe('paid');
    expect((await a.create('payment', { enrollmentId: e.id, amount: 1, method: 'cash' })).body.error.code).toBe('OVERPAYMENT');
    const free = (await a.create('course', { title: 'Free', instructorId: x.ins.id, price: 0 })).body.data; await a.create('lesson', { courseId: free.id, title: 'L', position: 1 }); await a.patch('course', free.id, { status: 'published' });
    const s2 = (await a.create('student', { name: 'F F', email: 'f@x.test' })).body.data; expect((await a.create('enrollment', { studentId: s2.id, courseId: free.id })).body.data.data.paymentStatus).toBe('paid');
    expect((await a.patch('enrollment', e.id, { price: 1 })).status).toBe(400);
  });
});

describe('learning progress', () => {
  it('requires payment; lesson must belong to the course; computes percent and completes at 100%', async () => {
    const a = await academy(); const x = await seed(a); const e = (await enrol(a, x)).body.data;
    expect((await a.create('lessonProgress', { enrollmentId: e.id, lessonId: x.l1.id })).body.error.code).toBe('PAYMENT_REQUIRED');
    await a.create('payment', { enrollmentId: e.id, amount: 50000, method: 'cash' });
    const other = (await a.create('course', { title: 'Other', instructorId: x.ins.id, price: 0 })).body.data; const ol = (await a.create('lesson', { courseId: other.id, title: 'Alien', position: 1 })).body.data;
    expect((await a.create('lessonProgress', { enrollmentId: e.id, lessonId: ol.id })).body.error.code).toBe('LESSON_NOT_IN_COURSE');
    expect((await a.create('lessonProgress', { enrollmentId: e.id, lessonId: x.l1.id })).status).toBe(201); expect((await a.get('enrollment', e.id)).body.data.data.progressPct).toBe(50);
    expect((await a.create('lessonProgress', { enrollmentId: e.id, lessonId: x.l1.id })).status).toBe(409);
    await a.create('lessonProgress', { enrollmentId: e.id, lessonId: x.l2.id }); const fin = (await a.get('enrollment', e.id)).body.data.data; expect(fin.progressPct).toBe(100); expect(fin.status).toBe('completed');
  });
  it('expired access blocks progress', async () => {
    const a = await academy(); const x = await seed(a); const e = await paidEnrollment(a, x); await a.patch('enrollment', e.id, { accessUntil: '2020-01-01' });
    expect((await a.create('lessonProgress', { enrollmentId: e.id, lessonId: x.l1.id })).body.error.code).toBe('ACCESS_EXPIRED');
  });
});

describe('exams', () => {
  const ans = (x: Awaited<ReturnType<typeof seed>>, c1: number, c2: number) => ({ answers: [{ questionId: x.q1.id, choice: c1 }, { questionId: x.q2.id, choice: c2 }] });
  it('grades exactly, enforces pass mark and attempt limit, requires payment', async () => {
    const a = await academy(); const x = await seed(a); const e = (await enrol(a, x)).body.data;
    expect((await a.create('attempt', { examId: x.exam.id, enrollmentId: e.id, ...ans(x, 1, 0) })).body.error.code).toBe('PAYMENT_REQUIRED');
    await a.create('payment', { enrollmentId: e.id, amount: 50000, method: 'cash' });
    const fail = (await a.create('attempt', { examId: x.exam.id, enrollmentId: e.id, ...ans(x, 1, 1) })).body.data; expect(fail.data.score).toBe(50); expect(fail.data.passed).toBe(false); expect(fail.code).toBe('AT-0001');
    const pass = (await a.create('attempt', { examId: x.exam.id, enrollmentId: e.id, ...ans(x, 1, 0) })).body.data; expect(pass.data.score).toBe(100); expect(pass.data.passed).toBe(true);
    expect((await a.create('attempt', { examId: x.exam.id, enrollmentId: e.id, ...ans(x, 1, 0) })).body.error.code).toBe('ATTEMPTS_EXCEEDED');
    expect((await a.patch('attempt', pass.id, { score: 0 })).status).toBe(405);
  });
  it('rejects foreign/duplicate questions and exams of another course', async () => {
    const a = await academy(); const x = await seed(a); const e = await paidEnrollment(a, x);
    const e2 = (await a.create('exam', { courseId: (await a.create('course', { title: 'C2', instructorId: x.ins.id, price: 0 })).body.data.id, title: 'Other exam' })).body.data;
    const q = (await a.create('question', { examId: e2.id, text: 'z', options: [{ text: 'a' }, { text: 'b' }], correctIndex: 0 })).body.data;
    expect((await a.create('attempt', { examId: x.exam.id, enrollmentId: e, answers: [{ questionId: q.id, choice: 0 }] })).status).toBe(400);
    expect((await a.create('attempt', { examId: x.exam.id, enrollmentId: e.id, answers: [{ questionId: q.id, choice: 0 }] })).status).toBe(400);
    expect((await a.create('attempt', { examId: x.exam.id, enrollmentId: e.id, answers: [{ questionId: x.q1.id, choice: 1 }, { questionId: x.q1.id, choice: 1 }] })).status).toBe(400);
    expect((await a.create('attempt', { examId: e2.id, enrollmentId: e.id, answers: [{ questionId: q.id, choice: 0 }] })).body.error.code).toBe('EXAM_NOT_IN_COURSE');
  });
});

describe('attendance & certificates', () => {
  it('attendance: unique per session, only enrolled course', async () => {
    const a = await academy(); const x = await seed(a); const e = await paidEnrollment(a, x);
    const sess = (await a.create('liveSession', { courseId: x.course.id, title: 'Live Q&A', startsAt: '2030-08-01T18:00:00.000Z', durationMin: 60 })).body.data;
    expect((await a.create('attendance', { sessionId: sess.id, enrollmentId: e.id, status: 'present' })).status).toBe(201); expect((await a.create('attendance', { sessionId: sess.id, enrollmentId: e.id })).status).toBe(409);
    const other = (await a.create('course', { title: 'O', instructorId: x.ins.id, price: 0 })).body.data; const os = (await a.create('liveSession', { courseId: other.id, title: 'O', startsAt: '2030-08-02T18:00:00.000Z' })).body.data;
    expect((await a.create('attendance', { sessionId: os.id, enrollmentId: e.id })).body.error.code).toBe('SESSION_NOT_IN_COURSE');
    await a.patch('liveSession', sess.id, { status: 'cancelled' }); const s2 = (await a.create('student', { name: 'Zed', email: 'z@x.test' })).body.data;
    expect((await a.create('attendance', { sessionId: sess.id, enrollmentId: (await enrol(a, x, { studentId: s2.id })).body.data.id })).body.error.code).toBe('SESSION_CANCELLED');
  });
  it('certificate needs completed course and passed exams; has a verification code; verifiable publicly', async () => {
    const a = await academy(); const x = await seed(a); const e = await paidEnrollment(a, x);
    expect((await a.create('certificate', { enrollmentId: e.id })).body.error.code).toBe('NOT_ELIGIBLE');
    await a.create('lessonProgress', { enrollmentId: e.id, lessonId: x.l1.id }); await a.create('lessonProgress', { enrollmentId: e.id, lessonId: x.l2.id });
    expect((await a.create('certificate', { enrollmentId: e.id })).body.error.code).toBe('NOT_ELIGIBLE'); // exam not passed yet
    await a.create('attempt', { examId: x.exam.id, enrollmentId: e.id, answers: [{ questionId: x.q1.id, choice: 1 }, { questionId: x.q2.id, choice: 0 }] });
    const c = await a.create('certificate', { enrollmentId: e.id }); expect(c.status).toBe(201);
    expect(c.body.data.code).toBe('CERT-0001'); expect(c.body.data.data.verifyCode).toMatch(/^[0-9a-f]{16}$/); expect(c.body.data.data.studentId).toBe(x.student.id);
    expect((await a.create('certificate', { enrollmentId: e.id })).status).toBe(409); expect((await a.patch('certificate', c.body.data.id, { enrollmentId: e.id })).status).toBe(405);
    const v = await request(ctx.app).get(`/api/v1/public/actions/verify?code=${c.body.data.data.verifyCode}`).set('Host', host());
    expect(v.status).toBe(200); expect(v.body.data).toMatchObject({ student: 'Ali Student', course: 'Intro to Python', valid: true }); expect(JSON.stringify(v.body)).not.toMatch(/email|phone|tenantId/);
    expect((await request(ctx.app).get('/api/v1/public/actions/verify?code=deadbeefdeadbeef').set('Host', host())).status).toBe(404);
    expect((await request(ctx.app).get(`/api/v1/public/actions/verify?code=${c.body.data.data.verifyCode}`).set('Host', host('beta'))).status).toBe(404);
  });
});

describe('public registration, permissions, analytics, search', () => {
  it('registration action creates/reuses the student and enrols; isolation', async () => {
    const a = await academy(); const x = await seed(a); const o = await academy('beta'); await seed(o);
    const body = { student: { name: 'Web Student', email: 'Web@X.test', phone: '٠١٠٩٩٩٨٨٨٧٧' }, courseId: x.course.id };
    const r = await request(ctx.app).post('/api/v1/public/actions/register').set('Host', host()).send(body);
    expect(r.status).toBe(201); expect(r.body.data).toMatchObject({ enrollmentCode: 'EN-0001', price: 50000, paymentStatus: 'unpaid' });
    expect((await request(ctx.app).post('/api/v1/public/actions/register').set('Host', host()).send(body)).status).toBe(409); // already enrolled
    expect((await a.list('student', '?q=web@x')).body.meta.total).toBe(1);
    expect((await request(ctx.app).post('/api/v1/public/actions/register').set('Host', host('beta')).send(body)).status).toBe(400); // other tenant's course
  });
  it('staff roles, KPIs, reports and search', async () => {
    const a = await academy(); const x = await seed(a); const e = await paidEnrollment(a, x); const emp = await employeeAgent(ctx.app, a, 'alpha');
    expect((await emp.agent.get('/api/v1/tenant/p/student')).status).toBe(200); for (const ent of ['question', 'exam', 'attempt']) expect((await emp.agent.get(`/api/v1/tenant/p/${ent}`)).status).toBe(403);
    await a.create('attempt', { examId: x.exam.id, enrollmentId: e.id, answers: [{ questionId: x.q1.id, choice: 0 }, { questionId: x.q2.id, choice: 1 }] });
    const k = await a.kpis(); expect(k.students).toBe(1); expect(k.activeEnrollments).toBe(1); expect(k.coursesPublished).toBe(1); expect(k.revenueMonth).toBe(50000); expect(k.certificatesIssued).toBe(0);
    expect((await a.report('enrollmentsByCourse'))[0]).toEqual({ key: x.course.id, value: 1 }); expect((await a.report('attemptsByResult'))[0]).toEqual({ key: '0', value: 1 });
    const t = async (q: string) => (await a.search(q)).map((s) => s.entityType);
    expect(await t('python')).toContain('course'); expect(await t('salma')).toContain('instructor'); expect(await t('ali@x')).toContain('student'); expect(await t('0100123')).toContain('student');
  });
});
