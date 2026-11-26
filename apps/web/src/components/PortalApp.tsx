'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { enumLabel, fieldLabel, fmtMoney, type Locale } from '@/lib/i18n';
import { AvatarCard, LearningCard, NotificationsCard, PaymentsCard } from './PortalExtras';
import { ReturnsCard } from './PortalReturns';

interface Account { id: string; name: string; email: string; phone: string | null; locale: string; hasAvatar?: boolean }
interface PayReq { code: string; targetCode: string; method: string; amount: number; status: string; reviewNote: string; createdAt: string }
interface My { paymentRequests?: PayReq[]; person: { id: string; code: string | null; name: string } | null; items: Record<string, Record<string, any>[]>; supported: boolean; product?: string }
type View = 'login' | 'register' | 'forgot' | 'reset' | 'verify' | 'check-mail';

/** Customer / patient / student portal. All calls go through the same-origin proxy; the tenant is chosen server-side from the host (or `site` for preview). */
export function PortalApp({ site, locale, currency, brandName }: { site?: string; locale: Locale; currency: string; brandName: string }) {
  const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const call = useCallback(<T,>(path: string, method = 'GET', body?: unknown) => api<T>(`/public/portal${path}`, { method, body, site, scope: 'portal' }), [site]);
  const [acct, setAcct] = useState<Account | null | undefined>(undefined);
  const [view, setView] = useState<View>('login'); const [token, setToken] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(false);
  const [my, setMy] = useState<My | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('verify')) { setToken(q.get('verify')!); setView('verify'); } else if (q.get('reset')) { setToken(q.get('reset')!); setView('reset'); }
    call<Account>('/me').then((r) => setAcct(r.data)).catch(() => setAcct(null));
  }, [call]);
  useEffect(() => { if (acct) call<My>('/my').then((r) => setMy(r.data)).catch(() => setMy(null)); }, [acct, call]);

  async function run(fn: () => Promise<void>) { setBusy(true); setMsg(null); try { await fn(); } catch (e) { const x = e as ApiError; setMsg({ ok: false, text: x.message + (x.fields ? ' — ' + Object.entries(x.fields).map(([k, v]) => `${fieldLabel(k, locale)}: ${v.join(', ')}`).join('; ') : '') }); } finally { setBusy(false); } }
  const form = (fn: (f: FormData) => Promise<void>) => (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(() => fn(f)); };
  const val = (f: FormData, k: string) => String(f.get(k) ?? '');

  if (acct === undefined) return <div className="card" role="status" aria-busy="true">{t('جارٍ التحميل…', 'Loading…')}</div>;

  if (!acct) return (
    <div className="card stack" style={{ maxWidth: 480, margin: '0 auto' }}>
      <h2>{brandName} — {t('حسابي', 'My account')}</h2>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      {view === 'check-mail' && <div className="alert ok" role="status">{t('أرسلنا رابط التأكيد إلى بريدك. افتحه لتفعيل الحساب.', 'We sent a confirmation link to your e-mail. Open it to activate your account.')}</div>}
      {view === 'verify' && <div className="stack"><p>{t('تأكيد البريد الإلكتروني', 'Confirm your e-mail')}</p>
        <button className="btn primary" disabled={busy} onClick={() => run(async () => { await call('/verify-email', 'POST', { token }); setView('login'); setMsg({ ok: true, text: t('تم تأكيد بريدك. يمكنك تسجيل الدخول الآن.', 'E-mail confirmed. You can sign in now.') }); })}>{t('تأكيد', 'Confirm')}</button></div>}
      {view === 'reset' && <form className="stack" onSubmit={form(async (f) => { await call('/reset-password', 'POST', { token, password: val(f, 'password') }); setView('login'); setMsg({ ok: true, text: t('تم تغيير كلمة المرور.', 'Password changed.') }); })}>
        <label className="field">{t('كلمة المرور الجديدة', 'New password')}<input name="password" type="password" minLength={10} required autoComplete="new-password" /></label>
        <span className="hint small">{t('10 أحرف على الأقل، حروف وأرقام.', 'At least 10 characters with letters and digits.')}</span><button className="btn primary" disabled={busy}>{t('حفظ', 'Save')}</button></form>}
      {view === 'login' && <form className="stack" onSubmit={form(async (f) => { const r = await call<{ account: Account }>('/login', 'POST', { email: val(f, 'email'), password: val(f, 'password') }); setAcct(r.data.account); })}>
        <label className="field">{t('البريد الإلكتروني', 'E-mail')}<input name="email" type="email" className="ltr" required autoComplete="email" /></label>
        <label className="field">{t('كلمة المرور', 'Password')}<input name="password" type="password" required autoComplete="current-password" /></label>
        <button className="btn primary" disabled={busy}>{t('دخول', 'Sign in')}</button>
        <div className="row between small"><button type="button" className="btn sm" onClick={() => { setMsg(null); setView('register'); }}>{t('إنشاء حساب', 'Create account')}</button><button type="button" className="btn sm" onClick={() => { setMsg(null); setView('forgot'); }}>{t('نسيت كلمة المرور؟', 'Forgot password?')}</button></div></form>}
      {view === 'register' && <form className="stack" onSubmit={form(async (f) => { const r = await call<{ account?: Account; verificationRequired?: boolean }>('/register', 'POST', { name: val(f, 'name'), email: val(f, 'email'), phone: val(f, 'phone') || undefined, password: val(f, 'password'), locale });
        if (r.data.account) setAcct(r.data.account); else setView('check-mail'); })}>
        <label className="field">{t('الاسم', 'Name')} *<input name="name" required minLength={2} autoComplete="name" /></label>
        <label className="field">{t('البريد الإلكتروني', 'E-mail')} *<input name="email" type="email" className="ltr" required autoComplete="email" /></label>
        <label className="field">{t('الهاتف', 'Phone')}<input name="phone" type="tel" className="ltr" autoComplete="tel" /></label>
        <label className="field">{t('كلمة المرور', 'Password')} *<input name="password" type="password" minLength={10} required autoComplete="new-password" /></label>
        <button className="btn primary" disabled={busy}>{t('إنشاء الحساب', 'Create account')}</button>
        <button type="button" className="btn sm" onClick={() => { setMsg(null); setView('login'); }}>{t('لدي حساب', 'I have an account')}</button></form>}
      {view === 'forgot' && <form className="stack" onSubmit={form(async (f) => { await call('/forgot-password', 'POST', { email: val(f, 'email') }); setMsg({ ok: true, text: t('إن كان البريد مسجلًا فسيصلك رابط إعادة التعيين.', 'If that e-mail is registered, a reset link is on its way.') }); })}>
        <label className="field">{t('البريد الإلكتروني', 'E-mail')}<input name="email" type="email" className="ltr" required /></label><button className="btn primary" disabled={busy}>{t('إرسال الرابط', 'Send link')}</button>
        <button type="button" className="btn sm" onClick={() => { setMsg(null); setView('login'); }}>{t('رجوع', 'Back')}</button></form>}
    </div>
  );

  const ent = (k: string) => enumLabel(k, locale);
  const money = (n: unknown) => (typeof n === 'number' ? fmtMoney(n, currency, locale) : '');
  return (
    <div className="stack">
      <div className="row between"><h2>{t('مرحبًا', 'Welcome')}، {acct.name}</h2>
        <button className="btn sm" onClick={() => run(async () => { await call('/logout', 'POST'); setAcct(null); setMy(null); setView('login'); })}>{t('تسجيل الخروج', 'Sign out')}</button></div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      <section className="card stack" aria-labelledby="mine"><h3 id="mine">{t('سجلاتي', 'My records')}</h3>
        {!my && <div role="status" aria-busy="true">{t('جارٍ التحميل…', 'Loading…')}</div>}
        {my && !my.supported && <p className="muted">{t('لا توجد سجلات متاحة في هذه البوابة.', 'No records are available in this portal.')}</p>}
        {my && my.supported && !my.person && <p className="muted">{t('لا توجد سجلات مرتبطة ببريدك بعد. ستظهر هنا بعد أن ينشئها النشاط التجاري باستخدام نفس البريد.', 'Nothing is linked to your e-mail yet. Records appear here once the business creates them with this same e-mail.')}</p>}
        {my?.person && Object.entries(my.items).filter(([entity]) => !['labRequest', 'imagingRequest'].includes(entity)).map(([entity, rows]) => (
          <div key={entity} className="stack"><h4>{fieldLabel(entity, locale)}</h4>
            {rows.length === 0 ? <p className="muted">{t('لا يوجد شيء بعد.', 'Nothing yet.')}</p> : <div className="table-wrap"><table><thead><tr><th>{t('الكود', 'Code')}</th>{Object.keys(rows[0]).filter((k) => !['id', 'code', 'createdAt', 'items'].includes(k) && !/Id$/.test(k)).map((k) => <th key={k}>{fieldLabel(k, locale)}</th>)}</tr></thead>
              <tbody>{rows.map((r) => <tr key={r.id}><td className="mono">{r.code ?? ''}</td>{Object.keys(rows[0]).filter((k) => !['id', 'code', 'createdAt', 'items'].includes(k) && !/Id$/.test(k)).map((k) => <td key={k}>{['price', 'paidAmount', 'subtotal', 'discount', 'shippingFee', 'tax', 'total'].includes(k) ? money(r[k]) : k === 'status' || k === 'paymentStatus' ? ent(String(r[k])) : String(r[k] ?? '')}</td>)}</tr>)}</tbody></table></div>}
          </div>))}
      </section>
      {my?.person && !!my.paymentRequests?.length && <section className="card stack" aria-labelledby="prq"><h3 id="prq">{t('طلبات الدفع الخاصة بي', 'My payment requests')}</h3><div className="table-wrap"><table><thead><tr><th scope="col">{t('الكود', 'Code')}</th><th scope="col">{t('المرتبط به', 'For')}</th><th scope="col">{t('الطريقة', 'Method')}</th><th scope="col">{t('المبلغ', 'Amount')}</th><th scope="col">{t('الحالة', 'Status')}</th></tr></thead><tbody>{my.paymentRequests.map((p) => <tr key={p.code}><td className="mono">{p.code}</td><td className="mono">{p.targetCode}</td><td>{p.method === 'instapay' ? 'InstaPay' : 'Vodafone Cash'}</td><td className="mono">{money(p.amount)}</td><td><span className={`badge ${p.status === 'approved' ? 'ok' : p.status === 'pending' ? 'warn' : 'bad'}`}>{({ pending: t('قيد المراجعة', 'Pending review'), approved: t('مقبول', 'Approved'), rejected: t('مرفوض', 'Rejected'), refunded: t('تم الاسترداد', 'Refunded') } as Record<string, string>)[p.status] ?? p.status}</span>{p.reviewNote && <div className="small muted">{p.reviewNote}</div>}</td></tr>)}</tbody></table></div></section>}
      {my?.product === 'medical' && my.person && <MedicalResults locale={locale} lab={my.items.labRequest ?? []} imaging={my.items.imagingRequest ?? []} />}
      {my?.product === 'learning' && <Courses site={site} locale={locale} currency={currency} acct={acct} onDone={() => call<My>('/my').then((r) => setMy(r.data)).catch(() => undefined)} />}
      {my?.product === 'booking' && <BookingCard site={site} locale={locale} acct={acct} onDone={() => call<My>('/my').then((r) => setMy(r.data)).catch(() => undefined)} />}
      {my?.product === 'medical' && <AppointmentRequest site={site} locale={locale} acct={acct} />}
      {my && my.product && !['learning', 'booking', 'medical'].includes(my.product) && my.supported && <section className="card row between"><span>{t('للحجز أو الطلب استخدم صفحات الموقع.', 'To book or order, use the website pages.')}</span><a className="btn primary" href={site ? `/sites/${site}` : '/'}>{t('فتح الموقع', 'Open website')}</a></section>}
      {my?.product === 'learning' && my.items.enrollment?.length > 0 && <LearningCard site={site} locale={locale} enrollments={my.items.enrollment.map((e) => ({ id: String(e.id), code: e.code ?? null }))} />}
      {my?.product === 'ecommerce' && my.person && <ReturnsCard site={site} locale={locale} orders={(my.items.order ?? []).map((x) => ({ id: String(x.id), code: x.code ?? null, status: String(x.status ?? ''), items: Array.isArray(x.items) ? x.items : [] }))} />}
      <PaymentsCard site={site} locale={locale} />
      <NotificationsCard site={site} locale={locale} />
      <section className="card stack" aria-labelledby="prof"><h3 id="prof">{t('بياناتي', 'My profile')}</h3>
        <AvatarCard site={site} locale={locale} hasAvatar={!!acct.hasAvatar} onChange={() => call<Account>('/me').then((r) => setAcct(r.data)).catch(() => undefined)} />
        <form className="grid g2" onSubmit={form(async (f) => { const r = await call<Account>('/me', 'PATCH', { name: val(f, 'name'), phone: val(f, 'phone') || null }); setAcct(r.data); setMsg({ ok: true, text: t('تم الحفظ.', 'Saved.') }); })}>
          <label className="field">{t('الاسم', 'Name')}<input name="name" defaultValue={acct.name} required minLength={2} /></label>
          <label className="field">{t('الهاتف', 'Phone')}<input name="phone" className="ltr" defaultValue={acct.phone ?? ''} type="tel" /></label>
          <div><button className="btn primary" disabled={busy}>{t('حفظ', 'Save')}</button></div></form>
        <form className="grid g2" onSubmit={form(async (f) => { await call('/change-password', 'POST', { current: val(f, 'current'), next: val(f, 'next') }); setMsg({ ok: true, text: t('تم تغيير كلمة المرور.', 'Password changed.') }); })}>
          <label className="field">{t('كلمة المرور الحالية', 'Current password')}<input name="current" type="password" required autoComplete="current-password" /></label>
          <label className="field">{t('كلمة المرور الجديدة', 'New password')}<input name="next" type="password" minLength={10} required autoComplete="new-password" /></label>
          <div><button className="btn" disabled={busy}>{t('تغيير كلمة المرور', 'Change password')}</button></div></form>
        <p className="muted small">{acct.email}</p>
      </section>
    </div>
  );
}

/** Learning portal: browse published courses and enrol with the signed-in account's details (uses the public `register` action; server validates everything). */
function Courses({ site, locale, currency, acct, onDone }: { site?: string; locale: Locale; currency: string; acct: Account; onDone: () => void }) {
  const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const [rows, setRows] = useState<{ id: string; title: string; price?: number }[] | null>(null); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    api<any[]>('/public/catalog/course?pageSize=50', { site }).then((r) => setRows(r.data.map((x) => ({ id: String(x.id), title: String(x.title ?? x.data?.title ?? x.id), price: typeof (x.price ?? x.data?.price) === 'number' ? (x.price ?? x.data?.price) : undefined })))).catch(() => setRows([]));
  }, [site]);
  const enrol = async (courseId: string) => {
    setBusy(courseId); setMsg(null);
    try { await api('/public/actions/register', { method: 'POST', site, body: { courseId, student: { name: acct.name, email: acct.email, phone: acct.phone ?? undefined } } }); setMsg({ ok: true, text: t('تم التسجيل في الدورة.', 'Enrolled successfully.') }); onDone(); }
    catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); } finally { setBusy(null); }
  };
  return (
    <section className="card stack" aria-labelledby="courses"><h3 id="courses">{t('الدورات المتاحة', 'Available courses')}</h3>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      {!rows && <div role="status" aria-busy="true">{t('جارٍ التحميل…', 'Loading…')}</div>}
      {rows && rows.length === 0 && <p className="muted">{t('لا توجد دورات منشورة حاليًا.', 'No published courses right now.')}</p>}
      {rows?.map((c) => <div key={c.id} className="row between"><span>{c.title}{c.price !== undefined ? ` — ${fmtMoney(c.price, currency, locale)}` : ''}</span><button className="btn sm primary" disabled={busy === c.id} onClick={() => enrol(c.id)}>{t('سجّل', 'Enrol')}</button></div>)}
    </section>
  );
}

const nm = (x: any): string => String(x?.name ?? x?.title ?? x?.data?.name ?? x?.data?.title ?? x?.id ?? '');
function useCatalog(entity: string, site?: string) {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { api<any[]>(`/public/catalog/${entity}?pageSize=50`, { site }).then((r) => setRows(r.data)).catch(() => setRows([])); }, [entity, site]);
  return rows;
}
type Msg = { ok: boolean; text: string } | null;

/** Booking product: pick a service and date, see real free slots, book (uses the public `availability` and `book` actions; the server re-validates everything). */
function BookingCard({ site, locale, acct, onDone }: { site?: string; locale: Locale; acct: Account; onDone: () => void }) {
  const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const services = useCatalog('service', site); const [serviceId, setServiceId] = useState(''); const [date, setDate] = useState('');
  const [slots, setSlots] = useState<{ staffId: string; staffName: string; slots: string[] }[] | null>(null); const [phone, setPhone] = useState(acct.phone ?? ''); const [msg, setMsg] = useState<Msg>(null); const [busy, setBusy] = useState(false);
  const check = async () => { setMsg(null); setSlots(null); setBusy(true); try { setSlots((await api<any[]>(`/public/actions/availability?serviceId=${encodeURIComponent(serviceId)}&date=${date}`, { site })).data); } catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); } finally { setBusy(false); } };
  const book = async (staffId: string, startTime: string) => {
    setMsg(null); setBusy(true);
    try { await api('/public/actions/book', { method: 'POST', site, body: { serviceId, date, startTime, staffId, customer: { name: acct.name, phone, email: acct.email } } }); setMsg({ ok: true, text: t('تم الحجز بنجاح.', 'Booked successfully.') }); setSlots(null); onDone(); }
    catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); } finally { setBusy(false); }
  };
  return (
    <section className="card stack" aria-labelledby="bk"><h3 id="bk">{t('احجز موعدًا', 'Book an appointment')}</h3>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      <div className="grid g2">
        <label className="field">{t('الخدمة', 'Service')}<select value={serviceId} onChange={(e) => setServiceId(e.target.value)}><option value="">—</option>{services?.map((x) => <option key={x.id} value={x.id}>{nm(x)}</option>)}</select></label>
        <label className="field">{t('التاريخ', 'Date')}<input type="date" value={date} min={new Date().toLocaleDateString('en-CA')} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field">{t('الهاتف', 'Phone')}<input type="tel" className="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} required /></label>
        <div><button className="btn" disabled={!serviceId || !date || busy} onClick={check}>{t('عرض المواعيد المتاحة', 'Show free slots')}</button></div>
      </div>
      {slots && slots.length === 0 && <p className="muted">{t('لا توجد مواعيد متاحة في هذا اليوم.', 'No free slots on this day.')}</p>}
      {slots?.map((g) => <div key={g.staffId} className="stack"><b>{g.staffName}</b><div className="row" style={{ flexWrap: 'wrap' }}>{g.slots.map((sl) => <button key={sl} className="btn sm" disabled={busy || !phone} onClick={() => book(g.staffId, sl)}>{sl}</button>)}</div></div>)}
    </section>
  );
}

/** Medical product: appointment REQUEST (the clinic confirms it) through the public form, with the signed-in patient's details. */
function AppointmentRequest({ site, locale, acct }: { site?: string; locale: Locale; acct: Account }) {
  const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const doctors = useCatalog('doctor', site); const services = useCatalog('service', site); const [msg, setMsg] = useState<Msg>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>; setBusy(true); setMsg(null);
    try { await api('/public/forms/appointmentRequest', { method: 'POST', site, body: { name: acct.name, phone: f.phone, doctorId: f.doctorId || undefined, serviceId: f.serviceId || undefined, preferredDate: f.preferredDate, preferredTime: f.preferredTime || undefined, message: f.message || undefined } }); setMsg({ ok: true, text: t('تم إرسال طلب الموعد، سنؤكده لك قريبًا.', 'Request sent — the clinic will confirm it soon.') }); (e.target as HTMLFormElement).reset(); }
    catch (x) { setMsg({ ok: false, text: (x as ApiError).message }); } finally { setBusy(false); }
  };
  return (
    <section className="card stack" aria-labelledby="ar"><h3 id="ar">{t('اطلب موعدًا', 'Request an appointment')}</h3>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      <form className="grid g2" onSubmit={submit}>
        <label className="field">{t('الطبيب', 'Doctor')}<select name="doctorId"><option value="">—</option>{doctors?.map((x) => <option key={x.id} value={x.id}>{nm(x)}</option>)}</select></label>
        <label className="field">{t('الخدمة', 'Service')}<select name="serviceId"><option value="">—</option>{services?.map((x) => <option key={x.id} value={x.id}>{nm(x)}</option>)}</select></label>
        <label className="field">{t('التاريخ المفضل', 'Preferred date')} *<input name="preferredDate" type="date" required min={new Date().toLocaleDateString('en-CA')} /></label>
        <label className="field">{t('الوقت المفضل', 'Preferred time')}<input name="preferredTime" type="time" /></label>
        <label className="field">{t('الهاتف', 'Phone')} *<input name="phone" type="tel" className="ltr" required defaultValue={acct.phone ?? ''} /></label>
        <label className="field">{t('ملاحظات', 'Notes')}<input name="message" maxLength={500} /></label>
        <div><button className="btn primary" disabled={busy}>{t('إرسال الطلب', 'Send request')}</button></div>
      </form>
    </section>
  );
}

/** The patient's own lab results and imaging reports. The API only sends result text once the lab / radiology has finished (never a draft). */
function MedicalResults({ locale, lab, imaging }: { locale: 'ar' | 'en'; lab: Record<string, any>[]; imaging: Record<string, any>[] }) {
  const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const state = (x: string) => ({ requested: t('تم الطلب', 'Requested'), sample_collected: t('تم أخذ العينة', 'Sample collected'), resulted: t('النتيجة جاهزة', 'Result ready'), scheduled: t('تم تحديد موعد', 'Scheduled'), performed: t('تم التصوير', 'Performed'), reported: t('التقرير جاهز', 'Report ready') } as Record<string, string>)[x] ?? x;
  return (
    <section className="card stack" aria-labelledby="results"><h3 id="results">{t('نتائج التحاليل والأشعة', 'Lab results & imaging reports')}</h3>
      {lab.length === 0 && imaging.length === 0 && <p className="muted">{t('لا توجد نتائج بعد.', 'No results yet.')}</p>}
      {lab.map((r) => (
        <article key={r.id} className="card flat stack"><div className="row between"><b>{r.test} <span className="mono small muted">{r.code}</span></b><span className={`badge ${r.status === 'resulted' ? 'ok' : 'warn'}`}>{state(String(r.status))}</span></div>
          {r.status === 'resulted' && Array.isArray(r.results) && r.results.length > 0 && <div className="table-wrap"><table><thead><tr><th scope="col">{t('البند', 'Parameter')}</th><th scope="col">{t('النتيجة', 'Value')}</th><th scope="col">{t('الوحدة', 'Unit')}</th><th scope="col">{t('المعدل الطبيعي', 'Reference range')}</th></tr></thead><tbody>{r.results.map((x: Record<string, string>, i: number) => <tr key={i}><td>{x.parameter}</td><td className="mono"><b>{x.value}</b></td><td>{x.unit ?? ''}</td><td className="mono small">{x.range ?? ''}</td></tr>)}</tbody></table></div>}
          {r.status === 'resulted' && r.resultText && <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{r.resultText}</p>}</article>))}
      {imaging.map((r) => (
        <article key={r.id} className="card flat stack"><div className="row between"><b>{r.modality} — {r.bodyPart} <span className="mono small muted">{r.code}</span></b><span className={`badge ${r.status === 'reported' ? 'ok' : 'warn'}`}>{state(String(r.status))}</span></div>
          {r.status === 'reported' && r.reportText && <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{r.reportText}</p>}</article>))}
    </section>
  );
}
