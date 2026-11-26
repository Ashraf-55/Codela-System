'use client';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { fmtMoney, type Locale } from '@/lib/i18n';

export interface Doc { id: string; name: string; bio?: string; specialtyId?: string; consultationFee?: number; image?: string; branchId?: string }
export interface Branch { id: string; name: string; address?: string; phone?: string; hours?: string; mapUrl?: string; mapEmbedUrl?: string }
export interface Spec { id: string; name: string; description?: string }
export interface Svc { id: string; name: string; price: number; durationMin?: number; specialtyId?: string }
export interface Sched { doctorId: string; weekday: number; from: string; to: string }
interface Faq { id: string; question: string; answer: string }
interface Art { id: string; title: string; summary?: string; body: string }
const DAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']; const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const today = () => new Date().toISOString().slice(0, 10);
const safePhoto = (u?: string) => (u && (/^https:\/\//.test(u) || /^\/api\/v1\/public\/files\/[0-9a-f-]{36}$/.test(u)) ? u : undefined);
const safeEmbed = (u?: string) => (u && /^https:\/\/www\.google\.com\/maps\/embed\?[^\s"'<>]+$/.test(u) ? u : undefined);
const L = (locale: Locale) => (ar: string, en: string) => (locale === 'ar' ? ar : en);

function Avatar({ d, size = 72 }: { d: Doc; size?: number }) {
  const src = safePhoto(d.image);
  return src ? <img src={src} alt={d.name} width={size} height={size} loading="lazy" style={{ borderRadius: '50%', objectFit: 'cover', width: size, height: size }} />
    : <span aria-hidden="true" className="brand-mark" style={{ width: size, height: size, borderRadius: '50%', fontSize: size / 2.4 }}>{d.name.replace(/^(dr\.?|د\.?)\s*/i, '').trim().slice(0, 1).toUpperCase()}</span>;
}
function Hours({ rows, locale }: { rows: Sched[]; locale: Locale }) {
  const t = L(locale); const names = locale === 'ar' ? DAYS_AR : DAYS_EN;
  if (!rows.length) return <p className="small muted">{t('يرجى التواصل لمعرفة المواعيد.', 'Please contact us for working hours.')}</p>;
  return <table className="small"><tbody>{[...rows].sort((a, b) => a.weekday - b.weekday || a.from.localeCompare(b.from)).map((r, i) => <tr key={i}><td>{names[r.weekday]}</td><td className="mono">{r.from} – {r.to}</td></tr>)}</tbody></table>;
}

/** Doctors directory with specialty filter, an inline full profile (photo, bio, working hours, fee) per doctor, and a direct "book" hand-off. Deep link: #doctor-<id>. */
export function DoctorsDirectory({ doctors, specialties, schedules, locale, currency, onBook, base = '' }: { doctors: Doc[]; specialties: Spec[]; schedules: Sched[]; locale: Locale; currency: string; onBook: (id: string) => void; base?: string }) {
  const t = L(locale); const [spec, setSpec] = useState(''); const [open, setOpen] = useState<string>('');
  const specName = (id?: string) => specialties.find((s) => s.id === id)?.name;
  useEffect(() => { const h = () => { const m = /^#doctor-(.+)$/.exec(window.location.hash); if (m) setOpen(m[1]); }; h(); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, []);
  const shown = doctors.filter((d) => !spec || d.specialtyId === spec);
  return (
    <section id="doctors" className="block"><div className="container stack"><h2>{t('أطباؤنا', 'Our doctors')}</h2>
      {!!specialties.length && <div className="row" style={{ flexWrap: 'wrap' }} role="group" aria-label={t('التخصصات', 'Specialties')}><button className={`btn sm${!spec ? ' primary' : ''}`} onClick={() => setSpec('')}>{t('الكل', 'All')}</button>{specialties.map((s) => <button key={s.id} className={`btn sm${spec === s.id ? ' primary' : ''}`} aria-pressed={spec === s.id} onClick={() => setSpec(s.id)}>{s.name}</button>)}</div>}
      {!shown.length && <p className="muted">{t('لا يوجد أطباء في هذا التخصص حاليًا.', 'No doctors in this specialty yet.')}</p>}
      <div className="grid g3">{shown.map((d) => { const mine = schedules.filter((x) => x.doctorId === d.id); const isOpen = open === d.id; return (
        <article key={d.id} id={`doctor-${d.id}`} className="card cat-card stack" style={{ textAlign: 'start' }}>
          <div className="row"><Avatar d={d} /><div><h3 style={{ margin: 0 }}>{d.name}</h3>{specName(d.specialtyId) && <div className="small muted">{specName(d.specialtyId)}</div>}{d.consultationFee ? <div className="small"><b>{fmtMoney(d.consultationFee, currency, locale)}</b> <span className="muted">· {t('الكشف', 'consultation')}</span></div> : null}</div></div>
          {d.bio && <p className="small" style={isOpen ? undefined : { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{d.bio}</p>}
          {isOpen && <div className="stack"><b className="small">{t('مواعيد العمل', 'Working hours')}</b><Hours rows={mine} locale={locale} /></div>}
          <div className="row"><button className="btn sm" aria-expanded={isOpen} onClick={() => { setOpen(isOpen ? '' : d.id); if (!isOpen) history.replaceState(null, '', `#doctor-${d.id}`); }}>{isOpen ? t('إخفاء المواعيد', 'Hide hours') : t('المواعيد', 'Hours')}</button><a className="btn sm" href={`${base}/doctors/${d.id}`}>{t('الملف الكامل', 'Full profile')}</a>
            <button className="btn sm primary" onClick={() => onBook(d.id)}>{t('احجز موعدًا', 'Book')}</button></div>
        </article>); })}</div></div></section>
  );
}

interface Slot { doctorId: string; doctorName: string; slots: string[] }
/** Real online booking against the doctor's schedule (server re-validates conflicts), plus code+phone lookup/cancel. */
export function MedicalBooking({ doctors, services, locale, currency, site, doctorId, setDoctorId }: { doctors: Doc[]; services: Svc[]; locale: Locale; currency: string; site?: string; doctorId: string; setDoctorId: (id: string) => void }) {
  const t = L(locale); const [svc, setSvc] = useState(''); const [date, setDate] = useState(today()); const [slots, setSlots] = useState<string[]>([]); const [time, setTime] = useState(''); const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState<{ code: string; date: string; startTime: string; doctorName: string } | null>(null);
  const [look, setLook] = useState<any>(null); const [auth, setAuth] = useState({ code: '', phone: '' }); const [msg, setMsg] = useState('');
  const doc = doctors.find((d) => d.id === doctorId); const mySvcs = useMemo(() => services.filter((s) => !doc?.specialtyId || !s.specialtyId || s.specialtyId === doc.specialtyId), [services, doc]);
  useEffect(() => {
    if (!doctorId) { setSlots([]); return; } let live = true; setLoading(true); setTime(''); setErr('');
    api<Slot[]>(`/public/actions/availability?doctorId=${doctorId}&date=${date}${svc ? `&serviceId=${svc}` : ''}`, { site }).then((r) => live && setSlots(r.data[0]?.slots ?? [])).catch((e: ApiError) => { if (live) { setSlots([]); setErr(e.message); } }).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [doctorId, date, svc, site]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); setErr('');
    try { const r = await api<any>('/public/actions/book', { method: 'POST', site, body: { doctorId, serviceId: svc || undefined, date, startTime: time, patient: { name: f.get('name'), phone: f.get('phone'), email: f.get('email') || undefined } } }); setDone(r.data); }
    catch (x) { setErr((x as ApiError).message); setTime(''); } finally { setBusy(false); }
  }
  async function lookup(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget); const a = { code: String(f.get('code')).trim().toUpperCase(), phone: String(f.get('phone')).trim() }; setMsg(''); setLook(null);
    try { setLook((await api<any>(`/public/actions/status?code=${encodeURIComponent(a.code)}&phone=${encodeURIComponent(a.phone)}`, { site })).data); setAuth(a); } catch (x) { setMsg((x as ApiError).message); }
  }
  async function cancel() {
    if (!confirm(t('هل تريد إلغاء الموعد؟', 'Cancel this appointment?'))) return;
    try { await api('/public/actions/cancel', { method: 'POST', site, body: auth }); setLook((await api<any>(`/public/actions/status?code=${auth.code}&phone=${encodeURIComponent(auth.phone)}`, { site })).data); setMsg(t('تم إلغاء الموعد.', 'Appointment cancelled.')); } catch (x) { setMsg((x as ApiError).message); }
  }
  return (
    <section id="book" className="block"><div className="container grid g2">
      {done ? (
        <div className="card stack" role="status" aria-live="polite"><h3>{t('تم استلام حجزك ✔', 'Appointment received ✔')}</h3><p>{t('سيقوم الاستقبال بتأكيد الموعد. احتفظ برقم الحجز مع رقم هاتفك.', 'Reception will confirm it. Keep your code with your phone number.')}</p>
          <dl className="dl"><dt>{t('رقم الحجز', 'Code')}</dt><dd className="mono"><b>{done.code}</b></dd><dt>{t('الطبيب', 'Doctor')}</dt><dd>{done.doctorName}</dd><dt>{t('الموعد', 'When')}</dt><dd className="mono">{done.date} · {done.startTime}</dd></dl><div><button className="btn" onClick={() => { setDone(null); setTime(''); }}>{t('حجز آخر', 'Book another')}</button></div></div>
      ) : (
        <div className="card stack"><h3>{t('احجز موعدًا', 'Book an appointment')}</h3>
          <div className="grid g2"><label className="field">{t('الطبيب', 'Doctor')}<select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}><option value="">{t('اختر الطبيب…', 'Choose a doctor…')}</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.name}{d.consultationFee ? ` — ${fmtMoney(d.consultationFee, currency, locale)}` : ''}</option>)}</select></label>
            <label className="field">{t('الخدمة (اختياري)', 'Service (optional)')}<select value={svc} onChange={(e) => setSvc(e.target.value)}><option value="">{t('كشف عام', 'General consultation')}</option>{mySvcs.map((s) => <option key={s.id} value={s.id}>{s.name} — {fmtMoney(s.price, currency, locale)}</option>)}</select></label>
            <label className="field">{t('التاريخ', 'Date')}<input type="date" className="ltr" min={today()} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></label></div>
          {doctorId && (loading ? <p className="muted" aria-busy="true">{t('جارٍ التحميل…', 'Loading…')}</p> : !slots.length ? <p className="muted">{t('لا مواعيد متاحة في هذا اليوم، جرّب يومًا آخر.', 'Nothing free on this day — try another date.')}</p> :
            <div className="row" style={{ flexWrap: 'wrap' }} role="group" aria-label={t('الأوقات المتاحة', 'Available times')}>{slots.map((x) => <button type="button" key={x} className={`btn sm${time === x ? ' primary' : ''}`} aria-pressed={time === x} onClick={() => setTime(x)}>{x}</button>)}</div>)}
          {doctorId && time && <form className="stack" onSubmit={submit}><div className="grid g2"><label className="field">{t('الاسم', 'Name')} *<input name="name" required minLength={2} autoComplete="name" /></label><label className="field">{t('الهاتف', 'Phone')} *<input name="phone" required type="tel" className="ltr" autoComplete="tel" /></label><label className="field">{t('البريد (اختياري)', 'Email (optional)')}<input name="email" type="email" className="ltr" /></label></div>
            <div><button className="btn primary" disabled={busy}>{busy ? '…' : t('تأكيد الحجز', 'Confirm booking')}</button></div></form>}
          {err && <div className="alert error" role="alert">{err}</div>}</div>
      )}
      <div className="card stack"><h3>{t('متابعة موعدك', 'Check or cancel your appointment')}</h3>
        <form className="row" onSubmit={lookup}><label className="field grow">{t('رقم الحجز', 'Code')}<input name="code" required className="ltr" placeholder="AP-0001" /></label><label className="field grow">{t('الهاتف', 'Phone')}<input name="phone" required type="tel" className="ltr" /></label><button className="btn">{t('بحث', 'Find')}</button></form>
        {msg && <div className="alert info" role="status">{msg}</div>}
        {look && <div className="stack"><dl className="dl"><dt>{t('الحالة', 'Status')}</dt><dd><b>{look.status}</b></dd><dt>{t('الطبيب', 'Doctor')}</dt><dd>{look.doctorName}</dd><dt>{t('الموعد', 'When')}</dt><dd className="mono">{look.date} · {look.startTime}</dd></dl>
          {['scheduled', 'confirmed'].includes(look.status) && <div><button className="btn danger" onClick={() => void cancel()}>{t('إلغاء الموعد', 'Cancel appointment')}</button></div>}</div>}</div>
    </div></section>
  );
}

export function Branches({ branches, locale }: { branches: Branch[]; locale: Locale }) {
  const t = L(locale); if (!branches.length) return null;
  return (<section id="branches" className="block"><div className="container stack"><h2>{t('فروعنا', 'Our branches')}</h2><div className="grid g2">{branches.map((b) => { const e = safeEmbed(b.mapEmbedUrl); return (
    <article key={b.id} className="card cat-card stack" style={{ textAlign: 'start' }}><h3>{b.name}</h3>{b.address && <p className="small">{b.address}</p>}{b.phone && <p className="small mono">{b.phone}</p>}{b.hours && <p className="small muted">{b.hours}</p>}
      {e ? <iframe title={`${t('خريطة', 'Map')} ${b.name}`} src={e} width="100%" height="220" style={{ border: 0, borderRadius: 12 }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" /> : null}
      {b.mapUrl && <div><a className="btn sm" href={b.mapUrl} target="_blank" rel="noopener noreferrer">{t('افتح الخريطة', 'Open map')}</a></div>}</article>); })}</div></div></section>);
}

export function ClinicInfo({ faqs, articles, locale }: { faqs: Faq[]; articles: Art[]; locale: Locale }) {
  const t = L(locale); const [openArt, setOpenArt] = useState('');
  return (<>
    {!!articles.length && <section id="articles" className="block"><div className="container stack"><h2>{t('مقالات طبية', 'Health articles')}</h2><div className="grid g3">{articles.map((a) => (
      <article key={a.id} className="card cat-card stack"><h3>{a.title}</h3>{a.summary && <p className="small muted">{a.summary}</p>}
        {openArt === a.id && <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{a.body}</div>}<div><button className="btn sm" aria-expanded={openArt === a.id} onClick={() => setOpenArt(openArt === a.id ? '' : a.id)}>{openArt === a.id ? t('إخفاء', 'Hide') : t('اقرأ المزيد', 'Read more')}</button></div></article>))}</div></div></section>}
    {!!faqs.length && <section id="faq" className="block"><div className="container stack"><h2>{t('الأسئلة الشائعة', 'FAQ')}</h2>{faqs.map((f) => <details key={f.id} className="card"><summary><b>{f.question}</b></summary><p style={{ whiteSpace: 'pre-wrap' }}>{f.answer}</p></details>)}</div></section>}
  </>);
}

/** Client wrapper so the "Book" buttons in the directory can pre-select the doctor in the booking form. */
export function MedicalSections(p: { branches: Branch[]; base?: string; doctors: Doc[]; specialties: Spec[]; schedules: Sched[]; services: Svc[]; faqs: Faq[]; articles: Art[]; locale: Locale; currency: string; site?: string }) {
  const [doctorId, setDoctorId] = useState('');
  return (<>
    <DoctorsDirectory doctors={p.doctors} specialties={p.specialties} schedules={p.schedules} locale={p.locale} currency={p.currency} base={p.base} onBook={(id) => { setDoctorId(id); document.getElementById('book')?.scrollIntoView({ behavior: 'smooth' }); }} />
    <MedicalBooking doctors={p.doctors} services={p.services} locale={p.locale} currency={p.currency} site={p.site} doctorId={doctorId} setDoctorId={setDoctorId} />
    <Branches branches={p.branches} locale={p.locale} />
    <ClinicInfo faqs={p.faqs} articles={p.articles} locale={p.locale} />
  </>);
}
