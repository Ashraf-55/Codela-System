import type { Request, RequestHandler, Router } from 'express';
import { z } from 'zod';
import type { Db } from '@codela/db';
import { HttpError, notFound } from './errors';
import { assertWritable } from './entitlements';
import { productOf } from './products/routes';
import { createRecord, getRecord, listRecords } from './products/store';
import { and, eq } from 'drizzle-orm';
import { files } from '@codela/db';
import { absPath, send } from './uploads';

/**
 * The learning side of the student portal. Every route is scoped to an enrolment that belongs to the signed-in account's own student record
 * (matched by the account e-mail, exactly like `/portal/my`). Writes go through the SAME entity hooks the staff dashboard uses, so payment,
 * access-expiry, attempt limits, deadlines and grading rules cannot be bypassed from the portal. Correct answers and other students' data are never returned.
 */
export interface LearningDeps { auth: RequestHandler; who: (req: Request) => { tenantId: string; email: string }; uploadDir: string }

const todayStr = () => new Date().toISOString().slice(0, 10);
/** Mirrors the dashboard rule (`requireAccess` in products/defs/learning.ts): null = the student may learn now. */
function accessIssue(e: { data: Record<string, unknown> }): { code: string; message: string } | null {
  if (!['active', 'completed'].includes(String(e.data.status))) return { code: 'NOT_ACTIVE', message: 'This enrollment is not active' };
  if (e.data.paymentStatus !== 'paid') return { code: 'PAYMENT_REQUIRED', message: 'Payment is required before learning activities' };
  if (e.data.accessUntil && String(e.data.accessUntil) < todayStr()) return { code: 'ACCESS_EXPIRED', message: 'Access to this course has expired' };
  return null;
}

export function learningPortalRoutes(r: Router, db: Db, d: LearningDeps) {
  const page = { page: 1, pageSize: 200, params: {} as Record<string, string> };
  function mine(req: Request) {
    const { tenantId, email } = d.who(req); const product = productOf(db, tenantId);
    if (product.slug !== 'learning') throw notFound('Not available');
    const def = (k: string) => product.entities.find((e) => e.key === k)!;
    const student = listRecords(db, tenantId, def('student'), { forced: { email }, ...page, pageSize: 1 }).rows[0];
    if (!student) throw notFound('No student record for this account');
    const enr = getRecord(db, tenantId, String(req.params.id));
    if (!enr || enr.entityType !== 'enrollment' || enr.data.studentId !== student.id) throw notFound('Enrollment not found'); // someone else's id is indistinguishable from a missing one
    return { tenantId, product, def, student, enr, ctx: { db, tenantId, userId: null, product } };
  }
  const rows = (m: ReturnType<typeof mine>, entity: string, forced: Record<string, unknown>) => listRecords(db, m.tenantId, m.def(entity), { forced, ...page }).rows;
  const child = (m: ReturnType<typeof mine>, id: string, entity: string) => { const x = getRecord(db, m.tenantId, id); if (!x || x.entityType !== entity || x.data.courseId !== m.enr.data.courseId) throw notFound('Not found'); return x; };
  const needAccess = (m: ReturnType<typeof mine>) => { const i = accessIssue(m.enr); if (i) throw new HttpError(409, i.code, i.message); };

  r.get('/portal/learning/enrollments/:id', d.auth, (req, res, next) => {
    try {
      const m = mine(req); const courseId = String(m.enr.data.courseId); const course = getRecord(db, m.tenantId, courseId);
      const issue = accessIssue(m.enr); const can = !issue;
      const done = new Set(rows(m, 'lessonProgress', { enrollmentId: m.enr.id }).map((p) => String(p.data.lessonId)));
      const lessons = rows(m, 'lesson', { courseId }).sort((a, b) => Number(a.data.position) - Number(b.data.position)).map((l) => {
        const open = can || !!l.data.isPreview; // previews are public by design; everything else needs paid, unexpired access
        return { id: l.id, position: l.data.position, title: l.data.title, kind: l.data.kind, durationMin: l.data.durationMin ?? null, preview: !!l.data.isPreview, completed: done.has(l.id),
          contentUrl: open ? l.data.contentUrl ?? null : null, body: open ? l.data.body ?? null : null,
          file: open && l.data.fileId ? (() => { const f = db.select().from(files).where(and(eq(files.id, String(l.data.fileId)), eq(files.tenantId, m.tenantId))).get(); return f ? { name: f.originalName, mime: f.mime, size: f.size } : null; })() : null };
      });
      const attempts = rows(m, 'attempt', { enrollmentId: m.enr.id });
      const exams = rows(m, 'exam', { courseId }).map((x) => { const mine_ = attempts.filter((a) => a.data.examId === x.id); const scores = mine_.map((a) => Number(a.data.score ?? 0));
        return { id: x.id, code: x.code, title: x.data.title, passScore: x.data.passScore ?? 60, maxAttempts: x.data.maxAttempts ?? 3, durationMin: x.data.durationMin ?? null, attemptsUsed: mine_.length,
          best: scores.length ? Math.max(...scores) : null, passed: mine_.some((a) => a.data.passed === true) }; });
      const subs = rows(m, 'submission', { enrollmentId: m.enr.id });
      const assignments = rows(m, 'assignment', { courseId }).map((a) => { const s = subs.find((x) => x.data.assignmentId === a.id);
        return { id: a.id, title: a.data.title, description: a.data.description ?? null, dueDate: a.data.dueDate ?? null, maxScore: a.data.maxScore ?? 100, open: a.data.status === 'open' && !(a.data.dueDate && String(a.data.dueDate) < todayStr()),
          submission: s ? { status: s.data.status, score: s.data.score ?? null, feedback: s.data.feedback ?? null, submittedAt: s.data.submittedAt, answerText: s.data.answerText } : null }; });
      const sessions = rows(m, 'liveSession', { courseId }).filter((s) => s.data.status !== 'cancelled').sort((a, b) => String(a.data.startsAt).localeCompare(String(b.data.startsAt)))
        .map((s) => ({ id: s.id, title: s.data.title, startsAt: s.data.startsAt, durationMin: s.data.durationMin ?? 60, status: s.data.status, joinUrl: can ? s.data.joinUrl ?? null : null }));
      const cert = rows(m, 'certificate', { studentId: m.student.id, courseId })[0];
      res.json({ data: {
        enrollment: { id: m.enr.id, code: m.enr.code, status: m.enr.data.status, progressPct: m.enr.data.progressPct ?? 0, paymentStatus: m.enr.data.paymentStatus, accessUntil: m.enr.data.accessUntil ?? null, canLearn: can, blockedBy: issue?.code ?? null },
        course: { id: courseId, title: course?.data.title ?? '', description: course?.data.description ?? null, level: course?.data.level ?? null, durationHours: course?.data.durationHours ?? null },
        lessons, exams, assignments, sessions, certificate: cert ? { verifyCode: cert.data.verifyCode, issuedAt: cert.data.issuedAt, number: cert.code } : null } });
    } catch (e) { next(e); }
  });

  r.post('/portal/learning/enrollments/:id/lessons/:lessonId/complete', d.auth, (req, res, next) => {
    try {
      const m = mine(req); assertWritable(db, m.tenantId); const lesson = child(m, String(req.params.lessonId), 'lesson');
      if (!rows(m, 'lessonProgress', { enrollmentId: m.enr.id, lessonId: lesson.id }).length) createRecord(m.ctx, m.def('lessonProgress'), { enrollmentId: m.enr.id, lessonId: lesson.id }); // hook: paid + unexpired + lesson in course
      const fresh = getRecord(db, m.tenantId, m.enr.id)!;
      res.json({ data: { progressPct: fresh.data.progressPct ?? 0, status: fresh.data.status } });
    } catch (e) { next(e); }
  });

  /** Streams (video, with Range support) or downloads (documents) the file of one lesson. Same rule as the lesson content itself: paid + unexpired access, or a free preview lesson. */
  r.get('/portal/learning/enrollments/:id/lessons/:lessonId/file', d.auth, (req, res, next) => {
    try {
      const m = mine(req); const l = child(m, String(req.params.lessonId), 'lesson');
      if (!l.data.isPreview) needAccess(m);
      const f = l.data.fileId ? db.select().from(files).where(and(eq(files.id, String(l.data.fileId)), eq(files.tenantId, m.tenantId), eq(files.entityId, l.id))).get() : undefined; if (!f) throw notFound('This lesson has no file');
      send(res, absPath(d.uploadDir, m.tenantId, f.storageKey), f, f.mime.startsWith('video/') && req.query.download !== '1' ? 'inline' : 'attachment', 'private, no-store');
    } catch (e) { next(e); }
  });
  r.get('/portal/learning/enrollments/:id/exams/:examId', d.auth, (req, res, next) => {
    try {
      const m = mine(req); needAccess(m); const exam = child(m, String(req.params.examId), 'exam');
      const used = rows(m, 'attempt', { enrollmentId: m.enr.id, examId: exam.id }).length; const max = Number(exam.data.maxAttempts ?? 3);
      // The question list never includes `correctIndex` (sensitive): only the text, the option labels and the points.
      const questions = rows(m, 'question', { examId: exam.id }).map((q) => ({ id: q.id, text: q.data.text, points: q.data.points ?? 1, options: ((q.data.options as { text: string }[]) ?? []).map((o) => o.text) }));
      res.json({ data: { id: exam.id, title: exam.data.title, passScore: exam.data.passScore ?? 60, durationMin: exam.data.durationMin ?? null, attemptsUsed: used, attemptsLeft: Math.max(0, max - used), questions } });
    } catch (e) { next(e); }
  });

  r.post('/portal/learning/enrollments/:id/exams/:examId/attempts', d.auth, (req, res, next) => {
    try {
      const m = mine(req); assertWritable(db, m.tenantId); const exam = child(m, String(req.params.examId), 'exam');
      const b = z.object({ answers: z.array(z.object({ questionId: z.string().min(1).max(64), choice: z.number().int().min(0).max(5) })).min(1).max(200) }).strict().parse(req.body);
      const rec = createRecord(m.ctx, m.def('attempt'), { examId: exam.id, enrollmentId: m.enr.id, answers: b.answers }); // hook: access, attempt limit, grading
      const used = rows(m, 'attempt', { enrollmentId: m.enr.id, examId: exam.id }).length;
      res.status(201).json({ data: { score: rec.data.score, passed: rec.data.passed, attemptsLeft: Math.max(0, Number(exam.data.maxAttempts ?? 3) - used) } });
    } catch (e) { next(e); }
  });

  r.post('/portal/learning/enrollments/:id/assignments/:assignmentId/submit', d.auth, (req, res, next) => {
    try {
      const m = mine(req); assertWritable(db, m.tenantId); const a = child(m, String(req.params.assignmentId), 'assignment');
      const b = z.object({ answerText: z.string().trim().min(1).max(10_000) }).strict().parse(req.body);
      createRecord(m.ctx, m.def('submission'), { assignmentId: a.id, enrollmentId: m.enr.id, answerText: b.answerText }); // hook: access, open, before the deadline, in this course
      res.status(201).json({ data: { ok: true } });
    } catch (e) { next(e); }
  });

  r.post('/portal/learning/enrollments/:id/certificate', d.auth, (req, res, next) => {
    try {
      const m = mine(req); assertWritable(db, m.tenantId); const courseId = String(m.enr.data.courseId);
      const existing = rows(m, 'certificate', { studentId: m.student.id, courseId })[0];
      const c = existing ?? createRecord(m.ctx, m.def('certificate'), { enrollmentId: m.enr.id }); // hook: course completed and every exam passed
      res.status(existing ? 200 : 201).json({ data: { verifyCode: c.data.verifyCode, issuedAt: c.data.issuedAt, number: c.code } });
    } catch (e) { next(e); }
  });
}
