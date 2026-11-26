import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDb, seedPlatform } from '@codela/db';
import { createApp } from '../src/app';
import { tenantClient, type TC } from './_helpers';

const PW = 'Str0ng-Pass!1';
function build() {
  const db = createDb(':memory:'); seedPlatform(db);
  const app = createApp({ db, secureCookies: false, authRateLimitMax: 1000, publicFormRateLimitMax: 1000, rootDomain: 'codela.test', portalEmailVerification: false });
  return { db, app };
}
const host = (slug: string) => `${slug}.codela.test`;
async function student(app: ReturnType<typeof createApp>, slug: string, email: string, name: string) {
  const agent = request.agent(app); const r = await agent.post('/api/v1/public/portal/register').set('Host', host(slug)).send({ name, email, password: PW }); expect(r.status).toBe(201);
  const csrf = r.body.data.csrfToken as string; const u = (p: string) => `/api/v1/public/portal/learning${p}`;
  return { get: (p: string) => agent.get(u(p)).set('Host', host(slug)), post: (p: string, b: object = {}) => agent.post(u(p)).set('Host', host(slug)).set('x-csrf-token', csrf).send(b) };
}
/** A published course with two text lessons, a 2-question exam (max 2 attempts) and two assignments (one open, one past its deadline). */
async function course(o: TC, price: number) {
  const ins = (await o.create('instructor', { name: 'Dr X' })).body.data; const c = (await o.create('course', { title: 'Course A', instructorId: ins.id, price })).body.data;
  const l1 = (await o.create('lesson', { courseId: c.id, title: 'L1', position: 1, kind: 'text', body: 'Lesson one body', durationMin: 5, isPreview: true })).body.data;
  const l2 = (await o.create('lesson', { courseId: c.id, title: 'L2', position: 2, kind: 'text', body: 'Lesson two body', durationMin: 5 })).body.data;
  expect((await o.patch('course', c.id, { status: 'published' })).status).toBe(200);
  const ex = (await o.create('exam', { courseId: c.id, title: 'Final', passScore: 60, maxAttempts: 2 })).body.data;
  const q1 = (await o.create('question', { examId: ex.id, text: 'Q1?', options: [{ text: 'A' }, { text: 'B' }], correctIndex: 1, points: 1 })).body.data;
  const q2 = (await o.create('question', { examId: ex.id, text: 'Q2?', options: [{ text: 'A' }, { text: 'B' }, { text: 'C' }], correctIndex: 2, points: 1 })).body.data;
  const hw = (await o.create('assignment', { courseId: c.id, title: 'HW1', dueDate: '2099-01-01', maxScore: 50 })).body.data;
  const late = (await o.create('assignment', { courseId: c.id, title: 'Late HW', dueDate: '2000-01-01', maxScore: 10 })).body.data;
  return { c, l1, l2, ex, q1, q2, hw, late };
}
async function enrol(o: TC, courseId: string, email: string, name: string) {
  const s = (await o.create('student', { name, email })).body.data; const e = await o.create('enrollment', { studentId: s.id, courseId }); expect(e.status).toBe(201); return { s, e: e.body.data };
}

describe('student portal: learning (free course)', () => {
  it('lesson viewer, progress, exam, assignment and certificate follow the dashboard rules', async () => {
    const { app } = build(); const o = await tenantClient(app, 'lp1', 'learning'); const k = await course(o, 0); const { e } = await enrol(o, k.c.id, 'sara@x.com', 'Sara Student');
    const me = await student(app, 'lp1', 'sara@x.com', 'Sara Student');
    const v = await me.get(`/enrollments/${e.id}`); expect(v.status).toBe(200);
    expect(v.body.data.enrollment).toMatchObject({ canLearn: true, blockedBy: null, progressPct: 0 }); expect(v.body.data.lessons.map((l: { body: string }) => l.body)).toEqual(['Lesson one body', 'Lesson two body']);
    expect(JSON.stringify(v.body)).not.toContain('correctIndex');

    // progress: idempotent, completes the enrolment at 100 %
    expect((await me.post(`/enrollments/${e.id}/lessons/${k.l1.id}/complete`)).body.data.progressPct).toBe(50);
    expect((await me.post(`/enrollments/${e.id}/lessons/${k.l1.id}/complete`)).body.data.progressPct).toBe(50);
    const done = await me.post(`/enrollments/${e.id}/lessons/${k.l2.id}/complete`); expect(done.body.data).toMatchObject({ progressPct: 100, status: 'completed' });

    // certificate needs every exam passed
    expect((await me.post(`/enrollments/${e.id}/certificate`)).status).toBe(409);
    const ex = await me.get(`/enrollments/${e.id}/exams/${k.ex.id}`); expect(ex.status).toBe(200); expect(ex.body.data.attemptsLeft).toBe(2);
    expect(ex.body.data.questions).toHaveLength(2); expect(JSON.stringify(ex.body)).not.toContain('correctIndex');
    const wrong = await me.post(`/enrollments/${e.id}/exams/${k.ex.id}/attempts`, { answers: [{ questionId: k.q1.id, choice: 0 }, { questionId: k.q2.id, choice: 0 }] });
    expect(wrong.status).toBe(201); expect(wrong.body.data).toMatchObject({ score: 0, passed: false, attemptsLeft: 1 });
    const right = await me.post(`/enrollments/${e.id}/exams/${k.ex.id}/attempts`, { answers: [{ questionId: k.q1.id, choice: 1 }, { questionId: k.q2.id, choice: 2 }] });
    expect(right.body.data).toMatchObject({ score: 100, passed: true, attemptsLeft: 0 });
    expect((await me.post(`/enrollments/${e.id}/exams/${k.ex.id}/attempts`, { answers: [{ questionId: k.q1.id, choice: 1 }] })).status).toBe(409);   // no attempts left
    const cert = await me.post(`/enrollments/${e.id}/certificate`); expect(cert.status).toBe(201); expect(cert.body.data.verifyCode).toMatch(/^[0-9a-f]{16}$/);
    const again = await me.post(`/enrollments/${e.id}/certificate`); expect(again.status).toBe(200); expect(again.body.data.verifyCode).toBe(cert.body.data.verifyCode);

    // assignments: submit once, never past the deadline, a student cannot grade themselves; staff grade it and the student sees the result
    expect((await me.post(`/enrollments/${e.id}/assignments/${k.late.id}/submit`, { answerText: 'too late' })).body.error.code).toBe('DEADLINE_PASSED');
    expect((await me.post(`/enrollments/${e.id}/assignments/${k.hw.id}/submit`, { answerText: 'My answer', score: 50 })).status).toBe(400);   // strict body: no score field
    expect((await me.post(`/enrollments/${e.id}/assignments/${k.hw.id}/submit`, { answerText: 'My answer' })).status).toBe(201);
    expect((await me.post(`/enrollments/${e.id}/assignments/${k.hw.id}/submit`, { answerText: 'Second try' })).status).toBeGreaterThanOrEqual(400);
    const sub = (await o.list('submission')).body.data[0]; expect(sub.data.status).toBe('submitted');
    expect((await o.patch('submission', sub.id, { score: 60 })).status).toBeGreaterThanOrEqual(400);   // above maxScore 50
    expect((await o.patch('submission', sub.id, { score: 45, feedback: 'Well done' })).status).toBe(200);
    const after = (await me.get(`/enrollments/${e.id}`)).body.data.assignments.find((a: { id: string }) => a.id === k.hw.id);
    expect(after.submission).toMatchObject({ status: 'graded', score: 45, feedback: 'Well done' });
  });
});

describe('student portal: learning (paid course, isolation)', () => {
  it('hides lesson content until paid, blocks writes, and never shows another student\'s enrolment', async () => {
    const { app } = build(); const o = await tenantClient(app, 'lp2', 'learning'); const k = await course(o, 5000);
    const a = await enrol(o, k.c.id, 'a@x.com', 'Student A'); const b = await enrol(o, k.c.id, 'b@x.com', 'Student B');
    const sa = await student(app, 'lp2', 'a@x.com', 'Student A'); const sb = await student(app, 'lp2', 'b@x.com', 'Student B');
    const v = (await sa.get(`/enrollments/${a.e.id}`)).body.data; expect(v.enrollment).toMatchObject({ canLearn: false, blockedBy: 'PAYMENT_REQUIRED' });
    expect(v.lessons[0].body).toBe('Lesson one body');          // the preview lesson is open
    expect(v.lessons[1].body).toBeNull(); expect(v.lessons[1].contentUrl).toBeNull();
    expect((await sa.post(`/enrollments/${a.e.id}/lessons/${k.l2.id}/complete`)).body.error.code).toBe('PAYMENT_REQUIRED');
    expect((await sa.get(`/enrollments/${a.e.id}/exams/${k.ex.id}`)).status).toBe(409);
    expect((await sa.post(`/enrollments/${a.e.id}/assignments/${k.hw.id}/submit`, { answerText: 'x' })).status).toBe(409);
    // paying through the dashboard unlocks everything
    expect((await o.create('payment', { enrollmentId: a.e.id, amount: 5000, method: 'cash' })).status).toBe(201);
    const paid = (await sa.get(`/enrollments/${a.e.id}`)).body.data; expect(paid.enrollment.canLearn).toBe(true); expect(paid.lessons[1].body).toBe('Lesson two body');
    // isolation: B cannot open A's enrolment (404, same as a missing id), and an account without a student record sees nothing
    expect((await sb.get(`/enrollments/${a.e.id}`)).status).toBe(404); expect((await sb.post(`/enrollments/${a.e.id}/lessons/${k.l1.id}/complete`)).status).toBe(404);
    expect((await sb.get(`/enrollments/${b.e.id}`)).status).toBe(200);
    const nobody = await student(app, 'lp2', 'nobody@x.com', 'No Record'); expect((await nobody.get(`/enrollments/${a.e.id}`)).status).toBe(404);
    expect((await request(app).get(`/api/v1/public/portal/learning/enrollments/${a.e.id}`).set('Host', host('lp2'))).status).toBe(401);
  });
  it('is not available on other products', async () => {
    const { app } = build(); await tenantClient(app, 'lp3', 'medical'); const c = await student(app, 'lp3', 'p@x.com', 'Pat');
    expect((await c.get('/enrollments/anything')).status).toBe(404);
  });
});
