import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { files } from '@codela/db';
import { notifyTenant } from '../../notify';
import { latinDigits, validateData, type EntityDef, type HookCtx, type ProductDef } from '../framework';

const category: EntityDef = { key: 'category', module: 'categories', labelEn: 'Course category', labelAr: 'تصنيف الدورات', titleField: 'name', searchFields: ['name'],
  fields: { name: { type: 'string', required: true, unique: true } }, public: { fields: ['name'] } };
const instructor: EntityDef = { key: 'instructor', module: 'instructors', labelEn: 'Instructor', labelAr: 'مدرب', titleField: 'name', searchFields: ['name', 'email', 'phone'], filterable: ['active'],
  fields: { name: { type: 'string', required: true }, bio: { type: 'text' }, email: { type: 'email' }, phone: { type: 'phone' }, active: { type: 'bool', default: true } },
  public: { fields: ['name', 'bio'], filter: { active: true } } };
const course: EntityDef = { key: 'course', module: 'courses', labelEn: 'Course', labelAr: 'دورة', titleField: 'title', subtitleField: '$code', autoCode: 'CR-', searchFields: ['title', 'description'], filterable: ['categoryId', 'instructorId', 'level', 'status', 'price'],
  fields: { title: { type: 'string', required: true }, categoryId: { type: 'ref', entity: 'category' }, instructorId: { type: 'ref', entity: 'instructor', required: true }, description: { type: 'text' },
    price: { type: 'money', default: 0 }, level: { type: 'enum', values: ['beginner', 'intermediate', 'advanced'], default: 'beginner' }, capacity: { type: 'int', min: 1 }, durationHours: { type: 'int', min: 0, max: 10000 },
    status: { type: 'enum', values: ['draft', 'published', 'archived'], default: 'draft' },
    // server-side rating aggregate from APPROVED reviews only (average x100, e.g. 450 = 4.5); never writable by the client
    ratingAvg100: { type: 'int', readonly: true }, ratingCount: { type: 'int', readonly: true } },
  beforeSave: (ctx, { action, data, existing }) => {
    if (action === 'create') return { ...data, status: 'draft', ratingAvg100: 0, ratingCount: 0 };
    if (data.status === 'published' && existing!.data.status !== 'published' && !ctx.find('lesson', { courseId: existing!.id }).length) ctx.fail(409, 'NO_LESSONS', 'Add at least one lesson before publishing');
  },
  public: { fields: ['title', 'categoryId', 'instructorId', 'description', 'price', 'level', 'durationHours', 'ratingAvg100', 'ratingCount'], filter: { status: 'published' }, filterable: ['categoryId', 'instructorId', 'level', 'price'] } };
const lesson: EntityDef = { key: 'lesson', module: 'lessons', labelEn: 'Lesson', labelAr: 'درس', titleField: 'title', searchFields: ['title'], filterable: ['courseId', 'kind'], defaultSort: { field: 'position', dir: 'asc' },
  fields: { courseId: { type: 'ref', entity: 'course', required: true, unique: true }, position: { type: 'int', min: 1, required: true, unique: true }, title: { type: 'string', required: true },
    kind: { type: 'enum', values: ['video', 'text', 'file'], default: 'video' }, contentUrl: { type: 'url' }, fileId: { type: 'string', max: 64 }, body: { type: 'text' }, durationMin: { type: 'int', min: 0, max: 1440 }, isPreview: { type: 'bool', default: false } },
  /** A hosted video / downloadable material is a file that was uploaded FOR THIS lesson (same tenant, attached to it); anything else is refused. */
  beforeSave: (ctx, { action, data, existing }) => {
    const id = String(data.fileId ?? ''); if (!id) return;
    if (action === 'create' || !existing) ctx.fail(400, 'VALIDATION_ERROR', 'Upload the file after the lesson is created');
    const f = ctx.db.select().from(files).where(and(eq(files.id, id), eq(files.tenantId, ctx.tenantId))).get();
    if (!f || f.entityType !== 'lesson' || f.entityId !== existing!.id) ctx.fail(400, 'VALIDATION_ERROR', 'This file was not uploaded for this lesson');
    if (data.kind === 'video' && !f!.mime.startsWith('video/')) ctx.fail(400, 'VALIDATION_ERROR', 'A video lesson needs an MP4 or WebM file');
  } };
const liveSession: EntityDef = { key: 'liveSession', module: 'sessions', labelEn: 'Live session', labelAr: 'جلسة مباشرة', titleField: 'title', searchFields: ['title'], filterable: ['courseId', 'status'],
  fields: { courseId: { type: 'ref', entity: 'course', required: true }, title: { type: 'string', required: true }, startsAt: { type: 'datetime', required: true }, durationMin: { type: 'int', min: 5, max: 1440, default: 60 },
    joinUrl: { type: 'url' }, status: { type: 'enum', values: ['scheduled', 'live', 'ended', 'cancelled'], default: 'scheduled' } } };
const student: EntityDef = { key: 'student', module: 'students', labelEn: 'Student', labelAr: 'طالب', titleField: 'name', subtitleField: '$code', autoCode: 'ST-', searchFields: ['name', 'email', 'phone'], filterable: ['status'],
  fields: { name: { type: 'string', required: true }, email: { type: 'email', required: true, unique: true }, phone: { type: 'phone' }, status: { type: 'enum', values: ['active', 'suspended'], default: 'active' } } };

const today = (ctx: HookCtx) => ctx.now.toISOString().slice(0, 10);
const enrollment: EntityDef = { key: 'enrollment', module: 'enrollments', labelEn: 'Enrollment', labelAr: 'تسجيل', titleField: '$code', subtitleField: 'status', autoCode: 'EN-', filterable: ['status', 'courseId', 'studentId', 'paymentStatus'],
  immutableWhen: { field: 'status', values: ['completed', 'cancelled'] }, noDelete: true,
  fields: { studentId: { type: 'ref', entity: 'student', required: true, unique: true }, courseId: { type: 'ref', entity: 'course', required: true, unique: true }, status: { type: 'enum', values: ['active', 'completed', 'cancelled'], default: 'active' },
    accessUntil: { type: 'date' }, price: { type: 'money', readonly: true }, paidAmount: { type: 'money', readonly: true }, paymentStatus: { type: 'enum', values: ['unpaid', 'paid'], readonly: true },
    progressPct: { type: 'int', readonly: true }, enrolledAt: { type: 'datetime', readonly: true } },
  beforeSave: (ctx, { action, data, existing }) => {
    if (action === 'create') {
      const c = ctx.get(String(data.courseId))!;
      if (c.data.status !== 'published') ctx.fail(409, 'NOT_PUBLISHED', 'This course is not open for enrollment');
      if (c.data.capacity && ctx.find('enrollment', { courseId: c.id }).filter((e) => e.data.status === 'active').length >= Number(c.data.capacity)) ctx.fail(409, 'COURSE_FULL', 'This course is full');
      const price = Number(c.data.price ?? 0);
      return { ...data, status: 'active', price, paidAmount: 0, paymentStatus: price === 0 ? 'paid' : 'unpaid', progressPct: 0, enrolledAt: ctx.now.toISOString() };
    }
    if (data.status !== existing!.data.status && data.status !== 'cancelled') ctx.fail(409, 'INVALID_TRANSITION', 'Enrollments can only be cancelled manually');
    return { ...existing!.data, status: data.status, accessUntil: data.accessUntil };
  } };
const payment: EntityDef = { key: 'payment', module: 'payments', labelEn: 'Payment', labelAr: 'دفعة', titleField: '$code', subtitleField: 'method', autoCode: 'PAY-', noUpdate: true, noDelete: true, filterable: ['enrollmentId', 'method'],
  fields: { enrollmentId: { type: 'ref', entity: 'enrollment', required: true }, amount: { type: 'money', min: 1, required: true }, method: { type: 'enum', values: ['cash', 'card', 'transfer', 'wallet'], required: true }, paidAt: { type: 'datetime' } },
  beforeSave: (ctx, { data }) => {
    const e = ctx.get(String(data.enrollmentId))!;
    if (e.data.status === 'cancelled') ctx.fail(409, 'NOT_ACTIVE', 'This enrollment is cancelled');
    if (Number(data.amount) > Number(e.data.price) - Number(e.data.paidAmount)) ctx.fail(409, 'OVERPAYMENT', 'Payment exceeds the outstanding balance');
    return { ...data, paidAt: data.paidAt ?? ctx.now.toISOString() };
  },
  afterSave: (ctx, { record }) => { const e = ctx.get(String(record.data.enrollmentId))!; const paid = Number(e.data.paidAmount) + Number(record.data.amount); ctx.patch(e.id, { paidAmount: paid, paymentStatus: paid >= Number(e.data.price) ? 'paid' : 'unpaid' }); } };

function requireAccess(ctx: HookCtx, enrollmentId: string) {
  const e = ctx.get(enrollmentId)!;
  if (!['active', 'completed'].includes(String(e.data.status))) ctx.fail(409, 'NOT_ACTIVE', 'This enrollment is not active');
  if (e.data.paymentStatus !== 'paid') ctx.fail(409, 'PAYMENT_REQUIRED', 'Payment is required before learning activities');
  if (e.data.accessUntil && String(e.data.accessUntil) < today(ctx)) ctx.fail(409, 'ACCESS_EXPIRED', 'Access to this course has expired');
  return e;
}
const lessonProgress: EntityDef = { key: 'lessonProgress', module: 'progress', labelEn: 'Lesson progress', labelAr: 'تقدم الدرس', titleField: 'lessonId', noUpdate: true, noDelete: true, filterable: ['enrollmentId', 'lessonId'],
  fields: { enrollmentId: { type: 'ref', entity: 'enrollment', required: true, unique: true }, lessonId: { type: 'ref', entity: 'lesson', required: true, unique: true }, completedAt: { type: 'datetime', readonly: true } },
  beforeSave: (ctx, { data }) => {
    const e = requireAccess(ctx, String(data.enrollmentId)); const l = ctx.get(String(data.lessonId))!;
    if (l.data.courseId !== e.data.courseId) ctx.fail(409, 'LESSON_NOT_IN_COURSE', 'This lesson belongs to a different course');
    return { ...data, completedAt: ctx.now.toISOString() };
  },
  afterSave: (ctx, { record }) => {
    const e = ctx.get(String(record.data.enrollmentId))!; const total = ctx.find('lesson', { courseId: e.data.courseId }).length;
    const done = ctx.find('lessonProgress', { enrollmentId: e.id }).length; const pct = total ? Math.floor((done * 100) / total) : 0;
    ctx.patch(e.id, pct >= 100 ? { progressPct: 100, status: 'completed' } : { progressPct: pct });
  } };

const exam: EntityDef = { key: 'exam', module: 'exams', labelEn: 'Exam', labelAr: 'اختبار', titleField: 'title', subtitleField: '$code', autoCode: 'EX-', searchFields: ['title'], filterable: ['courseId'],
  fields: { courseId: { type: 'ref', entity: 'course', required: true }, title: { type: 'string', required: true }, passScore: { type: 'int', min: 1, max: 100, default: 60 }, maxAttempts: { type: 'int', min: 1, max: 20, default: 3 }, durationMin: { type: 'int', min: 1, max: 600 } } };
const question: EntityDef = { key: 'question', module: 'questions', labelEn: 'Question', labelAr: 'سؤال', titleField: 'text', searchFields: ['text'], filterable: ['examId'], sensitive: true,
  fields: { examId: { type: 'ref', entity: 'exam', required: true }, text: { type: 'text', required: true }, options: { type: 'lines', required: true, max: 6, fields: { text: { type: 'string', required: true } } },
    correctIndex: { type: 'int', min: 0, max: 5, required: true, sensitive: true }, points: { type: 'int', min: 1, max: 100, default: 1 } },
  beforeSave: (ctx, { data }) => {
    const n = (data.options as unknown[]).length;
    if (n < 2) ctx.fail(400, 'VALIDATION_ERROR', 'A question needs at least two options');
    if (Number(data.correctIndex) >= n) ctx.fail(400, 'VALIDATION_ERROR', 'correctIndex must point to an existing option');
  } };
const attempt: EntityDef = { key: 'attempt', module: 'attempts', labelEn: 'Exam attempt', labelAr: 'محاولة اختبار', titleField: '$code', subtitleField: 'score', autoCode: 'AT-', noUpdate: true, noDelete: true, filterable: ['examId', 'enrollmentId', 'passed'],
  fields: { examId: { type: 'ref', entity: 'exam', required: true }, enrollmentId: { type: 'ref', entity: 'enrollment', required: true },
    answers: { type: 'lines', required: true, max: 200, fields: { questionId: { type: 'ref', entity: 'question', required: true }, choice: { type: 'int', min: 0, max: 5, required: true } } },
    score: { type: 'int', readonly: true }, passed: { type: 'bool', readonly: true }, submittedAt: { type: 'datetime', readonly: true } },
  beforeSave: (ctx, { data }) => {
    const ex = ctx.get(String(data.examId))!; const e = requireAccess(ctx, String(data.enrollmentId));
    if (ex.data.courseId !== e.data.courseId) ctx.fail(409, 'EXAM_NOT_IN_COURSE', 'This exam belongs to a different course');
    if (ctx.find('attempt', { examId: ex.id, enrollmentId: e.id }).length >= Number(ex.data.maxAttempts ?? 3)) ctx.fail(409, 'ATTEMPTS_EXCEEDED', 'No attempts left for this exam');
    const qs = ctx.find('question', { examId: ex.id }); if (!qs.length) ctx.fail(409, 'NO_QUESTIONS', 'This exam has no questions');
    const seen = new Set<string>(); let earned = 0;
    for (const a of data.answers as { questionId: string; choice: number }[]) {
      const q = qs.find((x) => x.id === a.questionId); if (!q) ctx.fail(400, 'VALIDATION_ERROR', 'An answer references a question outside this exam');
      if (seen.has(a.questionId)) ctx.fail(400, 'VALIDATION_ERROR', 'Duplicate answer for a question'); seen.add(a.questionId);
      if (a.choice === q!.data.correctIndex) earned += Number(q!.data.points ?? 1);
    }
    const total = qs.reduce((s, q) => s + Number(q.data.points ?? 1), 0); const score = Math.floor((earned * 100) / total);
    return { ...data, score, passed: score >= Number(ex.data.passScore ?? 60), submittedAt: ctx.now.toISOString() };
  } };
const attendance: EntityDef = { key: 'attendance', module: 'attendance', labelEn: 'Attendance', labelAr: 'حضور', titleField: 'status', filterable: ['sessionId', 'enrollmentId', 'status'],
  fields: { sessionId: { type: 'ref', entity: 'liveSession', required: true, unique: true }, enrollmentId: { type: 'ref', entity: 'enrollment', required: true, unique: true }, status: { type: 'enum', values: ['present', 'absent', 'late'], default: 'present' } },
  beforeSave: (ctx, { data }) => {
    const s = ctx.get(String(data.sessionId))!; const e = ctx.get(String(data.enrollmentId))!;
    if (s.data.courseId !== e.data.courseId) ctx.fail(409, 'SESSION_NOT_IN_COURSE', 'The session belongs to a different course');
    if (s.data.status === 'cancelled') ctx.fail(409, 'SESSION_CANCELLED', 'The session was cancelled');
  } };
const certificate: EntityDef = { key: 'certificate', module: 'certificates', labelEn: 'Certificate', labelAr: 'شهادة', titleField: '$code', autoCode: 'CERT-', noUpdate: true, noDelete: true, filterable: ['courseId', 'studentId'],
  fields: { enrollmentId: { type: 'ref', entity: 'enrollment', required: true, unique: true }, studentId: { type: 'ref', entity: 'student', readonly: true }, courseId: { type: 'ref', entity: 'course', readonly: true },
    verifyCode: { type: 'string', readonly: true }, issuedAt: { type: 'datetime', readonly: true } },
  beforeSave: (ctx, { data }) => {
    const e = ctx.get(String(data.enrollmentId))!;
    if (e.data.status !== 'completed') ctx.fail(409, 'NOT_ELIGIBLE', 'The student has not completed all lessons');
    const passed = new Set(ctx.find('attempt', { enrollmentId: e.id, passed: true }).map((a) => String(a.data.examId)));
    if (ctx.find('exam', { courseId: e.data.courseId }).some((x) => !passed.has(x.id))) ctx.fail(409, 'NOT_ELIGIBLE', 'All exams must be passed');
    return { ...data, studentId: e.data.studentId, courseId: e.data.courseId, verifyCode: randomBytes(8).toString('hex'), issuedAt: ctx.now.toISOString() };
  } };

// ---- assignments: homework a student submits from their own account; staff grade it from the dashboard ----
const assignment: EntityDef = { key: 'assignment', module: 'assignments', labelEn: 'Assignment', labelAr: 'واجب', titleField: 'title', subtitleField: 'status', searchFields: ['title'], filterable: ['courseId', 'status'],
  fields: { courseId: { type: 'ref', entity: 'course', required: true }, title: { type: 'string', required: true }, description: { type: 'text' }, dueDate: { type: 'date' },
    maxScore: { type: 'int', min: 1, max: 1000, default: 100 }, status: { type: 'enum', values: ['open', 'closed'], default: 'open' } } };
const submission: EntityDef = { key: 'submission', module: 'submissions', labelEn: 'Submission', labelAr: 'تسليم واجب', titleField: '$code', subtitleField: 'status', autoCode: 'SUB-', noDelete: true, filterable: ['assignmentId', 'enrollmentId', 'status'],
  fields: { assignmentId: { type: 'ref', entity: 'assignment', required: true, unique: true }, enrollmentId: { type: 'ref', entity: 'enrollment', required: true, unique: true }, answerText: { type: 'text', required: true },
    score: { type: 'int', min: 0, max: 1000 }, feedback: { type: 'text' }, status: { type: 'enum', values: ['submitted', 'graded'], readonly: true }, submittedAt: { type: 'datetime', readonly: true } },
  beforeSave: (ctx, { action, data, existing }) => {
    if (action === 'create') {
      const a = ctx.get(String(data.assignmentId))!; const e = requireAccess(ctx, String(data.enrollmentId));
      if (a.data.courseId !== e.data.courseId) ctx.fail(409, 'ASSIGNMENT_NOT_IN_COURSE', 'This assignment belongs to a different course');
      if (a.data.status !== 'open') ctx.fail(409, 'ASSIGNMENT_CLOSED', 'This assignment is closed');
      if (a.data.dueDate && String(a.data.dueDate) < today(ctx)) ctx.fail(409, 'DEADLINE_PASSED', 'The deadline for this assignment has passed');
      // Only these fields can ever come from the submitter: a student can never set their own score or status.
      return { assignmentId: data.assignmentId, enrollmentId: data.enrollmentId, answerText: data.answerText, status: 'submitted', submittedAt: ctx.now.toISOString() };
    }
    // Staff update = grading only (the submitted answer itself is never edited).
    const a = ctx.get(String(existing!.data.assignmentId))!; const score = data.score;
    if (score === undefined || score === null || score === '') ctx.fail(400, 'VALIDATION_ERROR', 'A score is required to grade a submission');
    if (Number(score) > Number(a.data.maxScore ?? 100)) ctx.fail(400, 'VALIDATION_ERROR', 'The score exceeds the maximum for this assignment');
    return { ...existing!.data, score: Number(score), feedback: data.feedback ?? existing!.data.feedback, status: 'graded' };
  } };

const faq: EntityDef = { key: 'faq', module: 'faqs', labelEn: 'FAQ', labelAr: 'سؤال شائع', titleField: 'question', searchFields: ['question'], filterable: ['active'],
  fields: { question: { type: 'string', required: true, max: 300 }, answer: { type: 'text', required: true }, position: { type: 'int', default: 0 }, active: { type: 'bool', default: true } },
  public: { fields: ['question', 'answer', 'position'], filter: { active: true } } };

/** Student reviews: created by an enrolled student through the public `submitReview` action (pending), shown on the site only once staff approve. */
const review: EntityDef = { key: 'review', module: 'reviews', noDelete: true, labelEn: 'Course review', labelAr: 'تقييم الكورس', titleField: '$code', subtitleField: 'rating', autoCode: 'RV-', searchFields: ['authorName', 'comment'], filterable: ['courseId', 'status', 'rating'],
  fields: { courseId: { type: 'ref', entity: 'course', required: true }, studentId: { type: 'ref', entity: 'student', readonly: true }, authorName: { type: 'string', required: true, max: 120 }, rating: { type: 'int', required: true, min: 1, max: 5 }, comment: { type: 'text' },
    status: { type: 'enum', values: ['pending', 'approved', 'hidden'], default: 'pending' } },
  afterSave: (ctx, { record }) => {
    const approved = ctx.find('review', { courseId: record.data.courseId, status: 'approved' }); const n = approved.length;
    ctx.patch(String(record.data.courseId), { ratingCount: n, ratingAvg100: n ? Math.round((approved.reduce((a, r) => a + Number(r.data.rating), 0) / n) * 100) : 0 });
  },
  public: { fields: ['courseId', 'authorName', 'rating', 'comment'], filter: { status: 'approved' }, filterable: ['courseId', 'rating'] } };

/** Class groups: students of a course organised into groups with a schedule and capacity. */
const studentGroup: EntityDef = { key: 'studentGroup', module: 'groups', labelEn: 'Group', labelAr: 'مجموعة', titleField: 'name', searchFields: ['name'], filterable: ['courseId', 'active'],
  fields: { name: { type: 'string', required: true, max: 120 }, courseId: { type: 'ref', entity: 'course', required: true }, instructorId: { type: 'ref', entity: 'instructor' }, schedule: { type: 'string', max: 200 }, capacity: { type: 'int', min: 1, max: 1000 }, active: { type: 'bool', default: true } } };
const groupMember: EntityDef = { key: 'groupMember', module: 'groups', labelEn: 'Group member', labelAr: 'عضو مجموعة', titleField: '$code', autoCode: 'GM-', noUpdate: true, filterable: ['groupId', 'studentId'],
  fields: { groupId: { type: 'ref', entity: 'studentGroup', required: true }, studentId: { type: 'ref', entity: 'student', required: true } },
  beforeSave: (ctx, { data }) => {
    const g = ctx.get(String(data.groupId))!; if (g.data.active === false) ctx.fail(409, 'GROUP_INACTIVE', 'This group is not active');
    if (!ctx.find('enrollment', { studentId: data.studentId, courseId: g.data.courseId }).some((e) => e.data.status !== 'cancelled')) ctx.fail(409, 'NOT_ENROLLED', 'The student is not enrolled in this group\'s course');
    const members = ctx.find('groupMember', { groupId: g.id }); if (members.some((m) => m.data.studentId === data.studentId)) ctx.fail(409, 'ALREADY_MEMBER', 'The student is already in this group');
    if (g.data.capacity && members.length >= Number(g.data.capacity)) ctx.fail(409, 'GROUP_FULL', 'The group is full');
  } };

export const learning: ProductDef = {
  slug: 'learning',
  entities: [category, instructor, course, lesson, liveSession, student, enrollment, payment, lessonProgress, exam, question, attempt, attendance, certificate, assignment, submission, faq, review, studentGroup, groupMember],
  kpis: [
    { key: 'students', labelEn: 'Students', labelAr: 'الطلاب', entity: 'student', agg: 'count' },
    { key: 'activeEnrollments', labelEn: 'Active enrollments', labelAr: 'تسجيلات نشطة', entity: 'enrollment', agg: 'count', where: { status: 'active' } },
    { key: 'coursesPublished', labelEn: 'Published courses', labelAr: 'دورات منشورة', entity: 'course', agg: 'count', where: { status: 'published' } },
    { key: 'revenueMonth', labelEn: 'Revenue this month', labelAr: 'إيراد الشهر', entity: 'payment', agg: 'sum', field: 'amount', period: 'month', dateField: 'paidAt', money: true },
    { key: 'certificatesIssued', labelEn: 'Certificates issued', labelAr: 'شهادات صادرة', entity: 'certificate', agg: 'count' },
  ],
  reports: [
    { key: 'enrollmentsByCourse', labelEn: 'Enrollments by course', labelAr: 'التسجيلات حسب الدورة', entity: 'enrollment', groupBy: 'courseId', agg: 'count' },
    { key: 'enrollmentsByStatus', labelEn: 'Enrollments by status', labelAr: 'التسجيلات حسب الحالة', entity: 'enrollment', groupBy: 'status', agg: 'count' },
    { key: 'attemptsByResult', labelEn: 'Exam attempts by result', labelAr: 'المحاولات حسب النتيجة', entity: 'attempt', groupBy: 'passed', agg: 'count' },
  ],
  publicForms: [],
  publicActions: [
    { key: 'course', method: 'GET', write: false, handler: (ctx, q) => {
      const c = ctx.get(String(q.id ?? '')); if (!c || c.entityType !== 'course' || c.data.status !== 'published') ctx.fail(404, 'NOT_FOUND', 'Course not found');
      const ins = ctx.get(String(c!.data.instructorId)); const lessons = ctx.find('lesson', { courseId: c!.id }).sort((a, b) => Number(a.data.position) - Number(b.data.position));
      return { course: { id: c!.id, title: c!.data.title, description: c!.data.description ?? null, price: c!.data.price, level: c!.data.level, durationHours: c!.data.durationHours ?? null },
        instructor: ins ? { name: ins.data.name, bio: ins.data.bio ?? null } : null,
        lessons: lessons.map((l) => ({ title: l.data.title, position: l.data.position, kind: l.data.kind, durationMin: l.data.durationMin ?? null, isPreview: !!l.data.isPreview })) };
    } },
    /** An enrolled student reviews their course: proves it with enrollment code + e-mail; one review per enrolment; stays pending until staff approve. */
    { key: 'submitReview', method: 'POST', write: true, status: 201, handler: (ctx, b) => {
      const en = ctx.byCode('enrollment', String(b.enrollmentCode ?? '').trim().toUpperCase()); const st = en && ctx.get(String(en.data.studentId));
      if (!en || !st || String(st.data.email).toLowerCase() !== String(b.email ?? '').trim().toLowerCase() || en.data.status === 'cancelled') ctx.fail(404, 'NOT_FOUND', 'No enrollment found for this code and e-mail');
      const rating = Number(b.rating); if (!Number.isInteger(rating) || rating < 1 || rating > 5) ctx.fail(400, 'VALIDATION_ERROR', 'rating must be 1 to 5');
      const comment = String(b.comment ?? '').trim().slice(0, 1000); if (ctx.find('review', { studentId: st!.id, courseId: en!.data.courseId }).length) ctx.fail(409, 'ALREADY_REVIEWED', 'You already reviewed this course');
      const rv = ctx.create('review', { courseId: en!.data.courseId, studentId: st!.id, authorName: st!.data.name, rating, comment: comment || undefined, status: 'pending' });
      notifyTenant(ctx.db, ctx.tenantId, 'review', `New course review ${rv.code}`, `${rating}/5`); return { code: rv.code, status: rv.data.status };
    } },
    { key: 'register', method: 'POST', write: true, status: 201, handler: (ctx, b) => {
      const sd = student; const v = validateData(sd, b.student, { partial: false });
      if (Object.keys(v.errors).length) ctx.fail(400, 'VALIDATION_ERROR', Object.entries(v.errors).map(([k, m]) => `${k} ${m}`).join('; '));
      const s = ctx.find('student', { email: v.data.email })[0] ?? ctx.createFull('student', v.data);
      const e = ctx.createFull('enrollment', { studentId: s.id, courseId: b.courseId });
      return { enrollmentCode: e.code, price: e.data.price, paymentStatus: e.data.paymentStatus };
    } },
    { key: 'verify', method: 'GET', write: false, handler: (ctx, q) => {
      const code = String(q.code ?? '').toLowerCase(); const c = /^[0-9a-f]{16}$/.test(code) ? ctx.find('certificate', { verifyCode: code })[0] : undefined;
      if (!c) ctx.fail(404, 'NOT_FOUND', 'Certificate not found');
      return { valid: true, student: ctx.get(String(c!.data.studentId))!.data.name, course: ctx.get(String(c!.data.courseId))!.data.title, issuedAt: c!.data.issuedAt, number: c!.code };
    } },
  ],
  employeeModules: { students: ['read', 'create', 'update'], enrollments: ['read', 'create'], courses: ['read'], lessons: ['read'], instructors: ['read'], categories: ['read'], payments: ['read', 'create'], attendance: ['read', 'create'], certificates: ['read'], sessions: ['read'], assignments: ['read'], submissions: ['read', 'update'], groups: ['read'], faqs: ['read'], reviews: ['read', 'update'] },
};
export { latinDigits };
