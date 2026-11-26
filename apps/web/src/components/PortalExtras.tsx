'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { enumLabel, fmtMoney, type Locale } from '@/lib/i18n';

type Msg = { ok: boolean; text: string } | null;
const csrf = () => (typeof document === 'undefined' ? '' : document.cookie.split('; ').find((c) => c.startsWith('cust_csrf='))?.split('=')[1] ?? '');
const pcall = <T,>(path: string, site: string | undefined, method = 'GET', body?: unknown) => api<T>(`/public/portal${path}`, { method, body, site, scope: 'portal' });
const Alert = ({ m }: { m: Msg }) => (m ? <div className={`alert ${m.ok ? 'ok' : 'error'}`} role={m.ok ? 'status' : 'alert'}>{m.text}</div> : null);
const safeUrl = (u: unknown) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);

/** Profile picture: validated server-side by its bytes (png/jpg/gif/webp, max 2 MB), private, only the owner can fetch it. */
export function AvatarCard({ site, locale, hasAvatar, onChange }: { site?: string; locale: Locale; hasAvatar: boolean; onChange: () => void }) {
  const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const [msg, setMsg] = useState<Msg>(null); const [busy, setBusy] = useState(false); const [v, setV] = useState(0);
  async function upload(file: File) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/v1/public/portal/avatar${site ? `?site=${encodeURIComponent(site)}` : ''}`, { method: 'PUT', credentials: 'same-origin', cache: 'no-store',
        headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name), 'x-csrf-token': csrf(), ...(site ? { 'x-codela-site': site } : {}) }, body: file });
      const j = await res.json().catch(() => ({})); if (!res.ok) throw new ApiError(res.status, j?.error?.code ?? 'ERROR', j?.error?.message ?? res.statusText);
      setV(Date.now()); setMsg({ ok: true, text: t('تم تحديث الصورة.', 'Picture updated.') }); onChange();
    } catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); } finally { setBusy(false); }
  }
  return (
    <div className="row" style={{ alignItems: 'center', gap: 16 }}>
      {hasAvatar ? <img src={`/api/v1/public/portal/avatar?v=${v}${site ? `&site=${encodeURIComponent(site)}` : ''}`} alt={t('صورتي', 'My picture')} width={72} height={72} style={{ borderRadius: '50%', objectFit: 'cover' }} /> : <span aria-hidden="true" style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--surface-2)', display: 'inline-block' }} />}
      <div className="stack"><label className="btn sm">{t('تغيير الصورة', 'Change picture')}<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} /></label>
        {hasAvatar && <button className="btn sm" disabled={busy} onClick={() => { setBusy(true); pcall('/avatar', site, 'DELETE').then(() => { setV(Date.now()); onChange(); }).catch((e) => setMsg({ ok: false, text: (e as ApiError).message })).finally(() => setBusy(false)); }}>{t('إزالة', 'Remove')}</button>}
        <Alert m={msg} /></div>
    </div>
  );
}

interface Note { id: string; subject: string; body: string; createdAt: string; delivery: 'sent' | 'pending' | 'not_delivered' }
/** What this business sent to the account's e-mail (booking / order / payment messages). `delivery` is honest: only "sent" means a provider accepted it. */
export function NotificationsCard({ site, locale }: { site?: string; locale: Locale }) {
  const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const [rows, setRows] = useState<Note[] | null>(null); const [err, setErr] = useState('');
  useEffect(() => { pcall<Note[]>('/notifications', site).then((r) => setRows(r.data)).catch((e) => { setErr((e as ApiError).message); setRows([]); }); }, [site]);
  const label = { sent: t('تم الإرسال', 'Sent'), pending: t('في الانتظار', 'Pending'), not_delivered: t('لم يُرسل', 'Not delivered') };
  return (
    <section className="card stack" aria-labelledby="ntf"><h3 id="ntf">{t('الإشعارات', 'Notifications')}</h3>
      {err && <div className="alert error" role="alert">{err}</div>}
      {!rows && <div role="status" aria-busy="true">{t('جارٍ التحميل…', 'Loading…')}</div>}
      {rows && rows.length === 0 && !err && <p className="muted">{t('لا توجد إشعارات بعد.', 'No notifications yet.')}</p>}
      {rows?.map((n) => <details key={n.id}><summary><b>{n.subject}</b> <span className="muted small">— {new Date(n.createdAt).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')} — {label[n.delivery]}</span></summary><p style={{ whiteSpace: 'pre-wrap' }}>{n.body}</p></details>)}
    </section>
  );
}

interface Pay { id: string; code: string | null; kind: string; date: string; total: number; paid: number; balance: number; status: string }
/** Read-only payment history for the customer's own invoices / bookings / orders / enrolments. */
export function PaymentsCard({ site, locale }: { site?: string; locale: Locale }) {
  const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const [d, setD] = useState<{ supported: boolean; currency: string; rows: Pay[] } | null>(null); const [err, setErr] = useState('');
  useEffect(() => { pcall<{ supported: boolean; currency: string; rows: Pay[] }>('/payments', site).then((r) => setD(r.data)).catch((e) => setErr((e as ApiError).message)); }, [site]);
  if (d && !d.supported) return null;
  const money = (n: number) => fmtMoney(n, d?.currency ?? 'EGP', locale);
  return (
    <section className="card stack" aria-labelledby="pay"><h3 id="pay">{t('المدفوعات', 'Payments')}</h3>
      {err && <div className="alert error" role="alert">{err}</div>}
      {!d && !err && <div role="status" aria-busy="true">{t('جارٍ التحميل…', 'Loading…')}</div>}
      {d && d.rows.length === 0 && <p className="muted">{t('لا توجد مدفوعات بعد.', 'No payments yet.')}</p>}
      {d && d.rows.length > 0 && <div className="table-wrap"><table><thead><tr><th>{t('الكود', 'Code')}</th><th>{t('التاريخ', 'Date')}</th><th>{t('الإجمالي', 'Total')}</th><th>{t('المدفوع', 'Paid')}</th><th>{t('المتبقي', 'Balance')}</th><th>{t('الحالة', 'Status')}</th></tr></thead>
        <tbody>{d.rows.map((r) => <tr key={r.id}><td className="mono">{r.code ?? ''}</td><td>{new Date(r.date).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB')}</td><td>{money(r.total)}</td><td>{money(r.paid)}</td><td>{money(r.balance)}</td><td>{enumLabel(r.status, locale)}</td></tr>)}</tbody></table></div>}
    </section>
  );
}

interface Course {
  enrollment: { id: string; code: string; status: string; progressPct: number; canLearn: boolean; blockedBy: string | null };
  course: { title: string; description: string | null };
  lessons: { id: string; position: number; title: string; kind: string; durationMin: number | null; preview: boolean; completed: boolean; contentUrl: string | null; body: string | null; file: { name: string; mime: string; size: number } | null }[];
  exams: { id: string; title: string; passScore: number; maxAttempts: number; attemptsUsed: number; best: number | null; passed: boolean }[];
  assignments: { id: string; title: string; description: string | null; dueDate: string | null; maxScore: number; open: boolean; submission: { status: string; score: number | null; feedback: string | null; answerText: string } | null }[];
  sessions: { id: string; title: string; startsAt: string; joinUrl: string | null }[];
  certificate: { verifyCode: string; number: string | null } | null;
}
interface ExamView { id: string; title: string; passScore: number; attemptsLeft: number; questions: { id: string; text: string; points: number; options: string[] }[] }

/** Learning area for ONE enrolment: lessons (with progress), exams, assignments, live sessions and the certificate. Every rule (payment, expiry, attempts, deadline) is enforced by the server. */
export function LearningCard({ site, locale, enrollments }: { site?: string; locale: Locale; enrollments: { id: string; code: string | null; courseId?: string }[] }) {
  const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const [sel, setSel] = useState(enrollments[0]?.id ?? ''); const [c, setC] = useState<Course | null>(null); const [msg, setMsg] = useState<Msg>(null); const [busy, setBusy] = useState(false);
  const [exam, setExam] = useState<ExamView | null>(null); const [answers, setAnswers] = useState<Record<string, number>>({}); const [open, setOpen] = useState('');
  const base = `/learning/enrollments/${sel}`;
  const load = useCallback(() => { if (!sel) return; pcall<Course>(`/learning/enrollments/${sel}`, site).then((r) => setC(r.data)).catch((e) => setMsg({ ok: false, text: (e as ApiError).message })); }, [sel, site]);
  useEffect(() => { setC(null); setExam(null); setOpen(''); load(); }, [load]);
  async function act(fn: () => Promise<string | void>) { setBusy(true); setMsg(null); try { const ok = await fn(); if (ok) setMsg({ ok: true, text: ok }); load(); } catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); } finally { setBusy(false); } }
  const submitAssignment = (id: string) => (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const text = String(new FormData(e.currentTarget).get('answerText') ?? ''); void act(async () => { await pcall(`${base}/assignments/${id}/submit`, site, 'POST', { answerText: text }); return t('تم تسليم الواجب.', 'Assignment submitted.'); }); };
  if (enrollments.length === 0) return null;
  return (
    <section className="card stack" aria-labelledby="learn"><h3 id="learn">{t('تعلّمي', 'My learning')}</h3>
      {enrollments.length > 1 && <label className="field">{t('الدورة', 'Course')}<select value={sel} onChange={(e) => setSel(e.target.value)}>{enrollments.map((x) => <option key={x.id} value={x.id}>{x.code ?? x.id}</option>)}</select></label>}
      <Alert m={msg} />
      {!c && !msg && <div role="status" aria-busy="true">{t('جارٍ التحميل…', 'Loading…')}</div>}
      {c && <>
        <div className="row between"><b>{c.course.title}</b><span className="muted">{c.enrollment.progressPct}% — {enumLabel(c.enrollment.status, locale)}</span></div>
        {!c.enrollment.canLearn && <div className="alert warn" role="status">{c.enrollment.blockedBy === 'PAYMENT_REQUIRED' ? t('يلزم سداد قيمة الدورة لفتح المحتوى. تواصل مع الجهة لإتمام الدفع.', 'Payment is required to unlock the content. Contact the business to complete payment.') : c.enrollment.blockedBy === 'ACCESS_EXPIRED' ? t('انتهت صلاحية وصولك لهذه الدورة.', 'Your access to this course has expired.') : t('هذا التسجيل غير نشط.', 'This enrolment is not active.')}</div>}

        <h4>{t('الدروس', 'Lessons')}</h4>
        <ol className="stack" style={{ paddingInlineStart: 20 }}>{c.lessons.map((l) => (
          <li key={l.id}><div className="row between"><button className="btn sm" aria-expanded={open === l.id} onClick={() => setOpen(open === l.id ? '' : l.id)}>{l.title}{l.durationMin ? ` (${l.durationMin} ${t('د', 'min')})` : ''}</button><span>{l.completed ? '✓' : ''}</span></div>
            {open === l.id && <div className="stack">
              {l.body === null && l.contentUrl === null && !l.file ? <p className="muted">{t('المحتوى مقفل.', 'Content is locked.')}</p> : <>
                {l.body && <p style={{ whiteSpace: 'pre-wrap' }}>{l.body}</p>}
                {l.file && (() => { const src = `/api/v1/public/portal/learning/enrollments/${sel}/lessons/${l.id}/file${site ? `?site=${encodeURIComponent(site)}` : ''}`; return l.file.mime.startsWith('video/')
                  ? <video controls preload="metadata" src={src} style={{ width: '100%', maxWidth: 720, borderRadius: 8 }} aria-label={l.title}>{t('المتصفح لا يدعم تشغيل الفيديو.', 'Your browser cannot play this video.')}</video>
                  : <a className="btn sm" data-testid="lesson-download" href={src} download={l.file.name}>{t('تحميل', 'Download')} {l.file.name}</a>; })()}
                {safeUrl(l.contentUrl) && <a href={safeUrl(l.contentUrl)!} target="_blank" rel="noopener noreferrer">{t('فتح المحتوى', 'Open content')}</a>}
                {c.enrollment.canLearn && !l.completed && <div><button className="btn sm primary" disabled={busy} onClick={() => void act(async () => { await pcall(`${base}/lessons/${l.id}/complete`, site, 'POST'); return t('تم تسجيل إتمام الدرس.', 'Lesson marked as complete.'); })}>{t('أتممت الدرس', 'Mark as complete')}</button></div>}</>}
            </div>}</li>))}</ol>

        {c.sessions.length > 0 && <><h4>{t('الجلسات المباشرة', 'Live sessions')}</h4>
          <ul>{c.sessions.map((s) => <li key={s.id}>{s.title} — {new Date(s.startsAt).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')} {safeUrl(s.joinUrl) && <a href={safeUrl(s.joinUrl)!} target="_blank" rel="noopener noreferrer">{t('انضم', 'Join')}</a>}</li>)}</ul></>}

        {c.exams.length > 0 && <><h4>{t('الاختبارات', 'Exams')}</h4>
          {c.exams.map((x) => <div key={x.id} className="row between"><span>{x.title} — {t('النجاح من', 'pass at')} {x.passScore}% — {x.attemptsUsed}/{x.maxAttempts} {t('محاولات', 'attempts')}{x.best !== null ? ` — ${t('أفضل نتيجة', 'best')} ${x.best}%` : ''} {x.passed ? '✓' : ''}</span>
            <button className="btn sm" disabled={busy || !c.enrollment.canLearn || x.attemptsUsed >= x.maxAttempts} onClick={() => void act(async () => { const r = await pcall<ExamView>(`${base}/exams/${x.id}`, site); setExam(r.data); setAnswers({}); })}>{t('ابدأ', 'Start')}</button></div>)}
          {exam && <form className="card stack" onSubmit={(e) => { e.preventDefault(); void act(async () => { const r = await pcall<{ score: number; passed: boolean; attemptsLeft: number }>(`${base}/exams/${exam.id}/attempts`, site, 'POST', { answers: Object.entries(answers).map(([questionId, choice]) => ({ questionId, choice })) }); setExam(null); return `${t('نتيجتك', 'Your score')}: ${r.data.score}% — ${r.data.passed ? t('ناجح', 'passed') : t('لم تنجح', 'not passed')}`; }); }}>
            <h4>{exam.title}</h4>{exam.questions.map((q, i) => <fieldset key={q.id} className="stack"><legend>{i + 1}. {q.text}</legend>{q.options.map((o, k) => <label key={k}><input type="radio" name={q.id} checked={answers[q.id] === k} onChange={() => setAnswers({ ...answers, [q.id]: k })} /> {o}</label>)}</fieldset>)}
            <div className="row"><button className="btn primary" disabled={busy || Object.keys(answers).length === 0}>{t('إرسال الإجابات', 'Submit answers')}</button><button type="button" className="btn" onClick={() => setExam(null)}>{t('إلغاء', 'Cancel')}</button></div></form>}</>}

        {c.assignments.length > 0 && <><h4>{t('الواجبات', 'Assignments')}</h4>
          {c.assignments.map((a) => <div key={a.id} className="card stack"><div className="row between"><b>{a.title}</b><span className="muted small">{a.dueDate ? `${t('الموعد النهائي', 'Due')} ${a.dueDate}` : ''} — {t('الدرجة', 'Max')} {a.maxScore}</span></div>
            {a.description && <p style={{ whiteSpace: 'pre-wrap' }}>{a.description}</p>}
            {a.submission ? <div className="stack"><p style={{ whiteSpace: 'pre-wrap' }}>{a.submission.answerText}</p><p className="muted">{a.submission.status === 'graded' ? `${t('الدرجة', 'Score')}: ${a.submission.score}/${a.maxScore}${a.submission.feedback ? ` — ${a.submission.feedback}` : ''}` : t('تم التسليم، بانتظار التصحيح.', 'Submitted, waiting for grading.')}</p></div>
              : a.open && c.enrollment.canLearn ? <form className="stack" onSubmit={submitAssignment(a.id)}><textarea name="answerText" required maxLength={10000} rows={4} aria-label={a.title} /><div><button className="btn sm primary" disabled={busy}>{t('تسليم', 'Submit')}</button></div></form>
              : <p className="muted">{t('التسليم مغلق.', 'Submissions are closed.')}</p>}</div>)}</>}

        <h4>{t('الشهادة', 'Certificate')}</h4>
        {c.certificate ? <p>{t('رقم الشهادة', 'Certificate no.')} <span className="mono">{c.certificate.number}</span> — {t('رمز التحقق', 'verification code')}: <span className="mono">{c.certificate.verifyCode}</span></p>
          : <div><button className="btn sm" disabled={busy || !c.enrollment.canLearn} onClick={() => void act(async () => { await pcall(`${base}/certificate`, site, 'POST'); return t('تم إصدار الشهادة.', 'Certificate issued.'); })}>{t('اطلب الشهادة', 'Request certificate')}</button> <span className="muted small">{t('بعد إتمام كل الدروس واجتياز كل الاختبارات.', 'After completing every lesson and passing every exam.')}</span></div>}
      </>}
    </section>
  );
}
