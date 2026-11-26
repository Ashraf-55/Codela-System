'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { fmtMoney, type Locale } from '@/lib/i18n';

export interface LCat { id: string; name: string }
export interface LIns { id: string; name: string; bio?: string }
export interface LCourse { id: string; title: string; categoryId?: string; instructorId?: string; description?: string; price: number; level?: string; durationHours?: number }
export interface LFaq { id: string; question: string; answer: string }
interface Detail { course: LCourse; instructor: { name: string; bio: string | null } | null; lessons: { title: string; position: number; kind: string; durationMin: number | null; isPreview: boolean }[] }
interface Review { id: string; authorName: string; rating: number; comment?: string }
const PAGE = 9; const LEVEL = { beginner: { ar: 'مبتدئ', en: 'Beginner' }, intermediate: { ar: 'متوسط', en: 'Intermediate' }, advanced: { ar: 'متقدم', en: 'Advanced' } } as Record<string, { ar: string; en: string }>;
const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

/** Public site of an academy: course catalogue filtered and paged ON THE SERVER, course page (lessons, instructor, reviews), enrolment, review form, instructors and FAQ. */
export function LearnSite({ cats, instructors, faqs, initial, locale, currency, site }: { cats: LCat[]; instructors: LIns[]; faqs: LFaq[]; initial: { rows: LCourse[]; total: number }; locale: Locale; currency: string; site?: string }) {
  const t = (ar: string, en: string) => (locale === 'ar' ? ar : en); const money = (n: number) => (n === 0 ? t('مجاني', 'Free') : fmtMoney(n, currency, locale));
  const [q, setQ] = useState(''); const [cat, setCat] = useState(''); const [level, setLevel] = useState(''); const [ins, setIns] = useState(''); const [page, setPage] = useState(1); const [courses, setCourses] = useState(initial); const [loading, setLoading] = useState(false); const [err, setErr] = useState('');
  const [open, setOpen] = useState<Detail | null>(null); const [reviews, setReviews] = useState<Review[]>([]); const [avg, setAvg] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<'enroll' | 'review'>('enroll'); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const first = useRef(true);
  const catName = (id?: string) => cats.find((c) => c.id === id)?.name;

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE) }); if (q.trim()) qs.set('q', q.trim()); if (cat) qs.set('categoryId', cat); if (level) qs.set('level', level); if (ins) qs.set('instructorId', ins);
      const r = await api<LCourse[]>(`/public/catalog/course?${qs}`, { site }); setCourses({ rows: r.data, total: r.meta?.total ?? r.data.length }); }
    catch (x) { setErr((x as ApiError).message); } finally { setLoading(false); }
  }, [q, cat, level, ins, page, site]);
  useEffect(() => { if (first.current) { first.current = false; return; } const h = setTimeout(() => void load(), 250); return () => clearTimeout(h); }, [load]);
  useEffect(() => { // average rating of the visible courses (approved reviews only)
    let live = true; void Promise.all(courses.rows.map((c) => api<Review[]>(`/public/catalog/review?courseId=${c.id}&pageSize=50`, { site }).then((r) => [c.id, r.data.length ? r.data.reduce((a, x) => a + x.rating, 0) / r.data.length : 0] as const).catch(() => [c.id, 0] as const)))
      .then((e) => { if (live) setAvg(Object.fromEntries(e)); }); return () => { live = false; };
  }, [courses.rows, site]);

  async function show(c: LCourse) {
    setMsg(null); setMode('enroll'); setOpen(null);
    try { const [d, r] = await Promise.all([api<Detail>(`/public/actions/course?id=${c.id}`, { site }), api<Review[]>(`/public/catalog/review?courseId=${c.id}&pageSize=20`, { site })]); setOpen(d.data); setReviews(r.data); }
    catch (x) { setMsg({ ok: false, text: (x as ApiError).message }); }
  }
  async function enroll(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!open) return; const f = new FormData(e.currentTarget); setBusy(true); setMsg(null);
    try { const r = await api<{ enrollmentCode: string; price: number; paymentStatus: string }>('/public/actions/register', { method: 'POST', site, body: { courseId: open.course.id, student: { name: String(f.get('name') ?? '').trim(), email: String(f.get('email') ?? '').trim(), ...(String(f.get('phone') ?? '').trim() ? { phone: String(f.get('phone')).trim() } : {}) } } });
      setMsg({ ok: true, text: `${t('تم تسجيلك. رقم التسجيل:', 'You are enrolled. Enrollment code:')} ${r.data.enrollmentCode}. ${r.data.paymentStatus === 'paid' ? t('الكورس مجاني وأصبح متاحًا في حسابك.', 'This course is free and available in your account.') : t('ادفع من قسم «ادفع» ليُفتح الكورس.', 'Pay from the “Pay” section to unlock the course.')}` }); }
    catch (x) { setMsg({ ok: false, text: (x as ApiError).message }); } finally { setBusy(false); }
  }
  async function sendReview(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); setMsg(null);
    try { await api('/public/actions/submitReview', { method: 'POST', site, body: { enrollmentCode: String(f.get('code') ?? '').trim(), email: String(f.get('email') ?? '').trim(), rating: Number(f.get('rating')), comment: String(f.get('comment') ?? '').trim() || undefined } });
      setMsg({ ok: true, text: t('شكرًا! سيظهر تقييمك بعد مراجعته.', 'Thank you! Your review will appear after it is approved.') }); } catch (x) { setMsg({ ok: false, text: (x as ApiError).message }); } finally { setBusy(false); }
  }
  const pages = Math.max(1, Math.ceil(courses.total / PAGE)); const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 60, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 12 };

  return (
    <>
      <section id="courses" className="block"><div className="container stack"><h2>{t('الكورسات', 'Courses')}</h2>
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="field grow">{t('ابحث عن كورس', 'Search courses')}<input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
          {cats.length > 0 && <label className="field">{t('التصنيف', 'Category')}<select value={cat} onChange={(e) => { setCat(e.target.value); setPage(1); }}><option value="">{t('الكل', 'All')}</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
          <label className="field">{t('المستوى', 'Level')}<select value={level} onChange={(e) => { setLevel(e.target.value); setPage(1); }}><option value="">{t('الكل', 'All')}</option>{Object.entries(LEVEL).map(([k, v]) => <option key={k} value={k}>{v[locale]}</option>)}</select></label>
          {instructors.length > 0 && <label className="field">{t('المدرّس', 'Instructor')}<select value={ins} onChange={(e) => { setIns(e.target.value); setPage(1); }}><option value="">{t('الكل', 'All')}</option>{instructors.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>}
        </div>
        {err && <div className="alert error" role="alert">{err}</div>}{msg && !open && <div className="alert error" role="alert">{msg.text}</div>}
        {!loading && courses.rows.length === 0 && <p className="muted">{t('لا توجد كورسات مطابقة.', 'No matching courses.')}</p>}
        <div className="grid g3" aria-busy={loading}>{courses.rows.map((c) => <article key={c.id} className="card stack"><b>{c.title}</b>
          <span className="muted small">{[catName(c.categoryId), c.level && LEVEL[c.level]?.[locale], c.durationHours ? `${c.durationHours} ${t('ساعة', 'h')}` : ''].filter(Boolean).join(' · ')}</span>
          {c.description && <p className="small">{c.description.slice(0, 120)}{c.description.length > 120 ? '…' : ''}</p>}
          {(avg[c.id] ?? 0) > 0 && <span aria-label={`${avg[c.id].toFixed(1)} / 5`} title={`${avg[c.id].toFixed(1)} / 5`}>{stars(Math.round(avg[c.id]))}</span>}
          <div className="row between"><b className="mono">{money(c.price)}</b><button className="btn sm primary" onClick={() => show(c)}>{t('التفاصيل والتسجيل', 'Details & enroll')}</button></div></article>)}</div>
        {pages > 1 && <div className="row between"><span className="muted small">{courses.total} {t('كورس', 'courses')}</span><div className="row"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('السابق', 'Previous')}</button><span className="small">{page} / {pages}</span><button className="btn sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t('التالي', 'Next')}</button></div></div>}
      </div></section>

      {open && (
        <div style={overlay} onClick={() => setOpen(null)}>
          <div className="card stack" role="dialog" aria-modal="true" aria-label={open.course.title} onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', maxWidth: 720, width: '100%', maxHeight: '92vh', overflow: 'auto', textAlign: 'start' }}>
            <div className="row between"><h3>{open.course.title}</h3><button className="btn sm" onClick={() => setOpen(null)} aria-label={t('إغلاق', 'Close')}>✕</button></div>
            <span className="muted small">{[catName(open.course.categoryId), open.course.level && LEVEL[open.course.level]?.[locale], open.instructor?.name].filter(Boolean).join(' · ')} · <b className="mono">{money(open.course.price)}</b></span>
            {open.course.description && <p>{open.course.description}</p>}{open.instructor?.bio && <p className="small muted">{open.instructor.bio}</p>}
            <h4>{t('محتوى الكورس', 'Course content')} ({open.lessons.length})</h4>
            <ol className="stack" style={{ gap: 4, paddingInlineStart: 20 }}>{open.lessons.map((l) => <li key={l.position}>{l.title}{l.durationMin ? ` · ${l.durationMin} ${t('دقيقة', 'min')}` : ''} {l.isPreview && <span className="badge ok">{t('معاينة مجانية', 'Free preview')}</span>}</li>)}</ol>
            {reviews.length > 0 && <><h4>{t('آراء الطلاب', 'Student reviews')}</h4>{reviews.map((r) => <div key={r.id} className="stack" style={{ gap: 2 }}><b>{r.authorName} <span aria-label={`${r.rating}/5`}>{stars(r.rating)}</span></b>{r.comment && <span className="small">{r.comment}</span>}</div>)}</>}
            <div className="row" role="group"><button className={`btn sm${mode === 'enroll' ? ' primary' : ''}`} aria-pressed={mode === 'enroll'} onClick={() => { setMode('enroll'); setMsg(null); }}>{t('سجّل في الكورس', 'Enroll')}</button><button className={`btn sm${mode === 'review' ? ' primary' : ''}`} aria-pressed={mode === 'review'} onClick={() => { setMode('review'); setMsg(null); }}>{t('قيّم الكورس', 'Rate this course')}</button></div>
            {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
            {mode === 'enroll' ? (
              <form className="stack" onSubmit={enroll}><label className="field">{t('الاسم', 'Name')} *<input name="name" required minLength={2} autoComplete="name" /></label><label className="field">{t('البريد الإلكتروني', 'E-mail')} *<input name="email" type="email" required className="ltr" autoComplete="email" /></label><label className="field">{t('الهاتف', 'Phone')}<input name="phone" type="tel" className="ltr" autoComplete="tel" /></label><div><button className="btn primary" disabled={busy}>{busy ? '…' : t('تأكيد التسجيل', 'Confirm enrollment')}</button></div></form>
            ) : (
              <form className="stack" onSubmit={sendReview}><p className="small muted">{t('للطلاب المسجّلين فقط: اكتب رقم التسجيل وبريدك.', 'Enrolled students only: enter your enrollment code and e-mail.')}</p><label className="field">{t('رقم التسجيل', 'Enrollment code')} *<input name="code" required className="ltr" /></label><label className="field">{t('البريد الإلكتروني', 'E-mail')} *<input name="email" type="email" required className="ltr" /></label>
                <label className="field">{t('التقييم', 'Rating')} *<select name="rating" defaultValue="5">{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{stars(n)}</option>)}</select></label><label className="field">{t('رأيك', 'Your review')}<textarea name="comment" maxLength={1000} /></label><div><button className="btn primary" disabled={busy}>{busy ? '…' : t('إرسال التقييم', 'Send review')}</button></div></form>
            )}
          </div>
        </div>)}

      {instructors.length > 0 && <section id="instructors" className="block"><div className="container stack"><h2>{t('المدرّسون', 'Instructors')}</h2><div className="grid g3">{instructors.map((i) => <article key={i.id} className="card stack"><b>{i.name}</b>{i.bio && <p className="small muted">{i.bio}</p>}</article>)}</div></div></section>}
      {faqs.length > 0 && <section id="faq" className="block"><div className="container stack" style={{ maxWidth: 760 }}><h2>{t('أسئلة شائعة', 'FAQ')}</h2>{faqs.map((f) => <details key={f.id} className="card"><summary><b>{f.question}</b></summary><p>{f.answer}</p></details>)}</div></section>}
    </>
  );
}
