'use client';
import { useEffect, useMemo, useState } from 'react';
import { confirmDialog } from '@/components/Providers';
import { ApiError, api } from '@/lib/api';
import { fmtMoney, type Locale } from '@/lib/i18n';

interface Svc { id: string; name: string; durationMin: number; price: number; description?: string; categoryId?: string }
interface Group { staffId: string; staffName: string; slots: string[] }
interface Done { code: string; status: string; date: string; startTime: string; endTime: string; staffName: string; price: number }
const today = () => new Date().toISOString().slice(0, 10);
const L = (locale: Locale) => (ar: string, en: string) => (locale === 'ar' ? ar : en);

/** Public online booking: service -> staff -> date -> free slot -> details. Slots come from the server's scheduling engine; the server re-validates on submit. */
export function BookingWizard({ locale, currency, site }: { locale: Locale; currency: string; site?: string }) {
  const t = L(locale); const [svcs, setSvcs] = useState<Svc[]>([]); const [svc, setSvc] = useState<Svc | null>(null); const [date, setDate] = useState(today());
  const [groups, setGroups] = useState<Group[]>([]); const [loading, setLoading] = useState(false); const [staffId, setStaffId] = useState(''); const [slot, setSlot] = useState<{ staffId: string; time: string } | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState<Done | null>(null);
  useEffect(() => { api<Svc[]>('/public/catalog/service?pageSize=100', { site }).then((r) => setSvcs(r.data)).catch(() => setErr(t('تعذر تحميل الخدمات', 'Could not load services'))); }, [site]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!svc) return; let live = true; setLoading(true); setSlot(null); setErr('');
    api<Group[]>(`/public/actions/availability?serviceId=${svc.id}&date=${date}`, { site }).then((r) => live && setGroups(r.data)).catch((e: ApiError) => { if (live) { setGroups([]); setErr(e.message); } }).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [svc, date, site]);
  const staffOptions = groups.map((g) => ({ id: g.staffId, name: g.staffName }));
  const visible = useMemo(() => (staffId ? groups.filter((g) => g.staffId === staffId) : groups), [groups, staffId]);
  const anyTimes = useMemo(() => [...new Set(groups.flatMap((g) => g.slots))].sort(), [groups]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!svc || !slot) return; const f = new FormData(e.currentTarget); setBusy(true); setErr('');
    try {
      const r = await api<Done>('/public/actions/book', { method: 'POST', site, body: { serviceId: svc.id, date, startTime: slot.time, staffId: staffId || undefined, website: f.get('website'), customer: { name: f.get('name'), phone: f.get('phone'), email: f.get('email') || undefined } } });
      setDone(r.data);
    } catch (x) { setErr((x as ApiError).message); if ((x as ApiError).code === 'SLOT_TAKEN' || (x as ApiError).code === 'NO_AVAILABILITY') { setSlot(null); setDate((d) => d + ''); } } finally { setBusy(false); }
  }
  if (done) return (
    <section className="card stack" role="status" aria-live="polite"><h3>{t('تم استلام حجزك ✔', 'Your booking is received ✔')}</h3>
      <p>{t('احتفظ برقم الحجز، ستحتاجه مع رقم هاتفك لمتابعة الحجز أو تعديله.', 'Keep this code — you need it with your phone number to track, change or cancel.')}</p>
      <dl className="dl"><dt>{t('رقم الحجز', 'Booking code')}</dt><dd className="mono"><b>{done.code}</b></dd><dt>{t('الموعد', 'When')}</dt><dd className="mono">{done.date} · {done.startTime}–{done.endTime}</dd><dt>{t('مقدم الخدمة', 'With')}</dt><dd>{done.staffName}</dd><dt>{t('السعر', 'Price')}</dt><dd>{fmtMoney(done.price, currency, locale)}</dd><dt>{t('الحالة', 'Status')}</dt><dd>{t('بانتظار تأكيد النشاط', 'Awaiting confirmation')}</dd></dl>
      <div><button className="btn" onClick={() => { setDone(null); setSlot(null); setSvc(null); }}>{t('حجز آخر', 'Book another')}</button></div></section>
  );
  return (
    <section className="card stack" aria-label={t('احجز موعدًا', 'Book an appointment')}><h3>{t('احجز موعدك أونلاين', 'Book online')}</h3>
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}><legend><b>1. {t('اختر الخدمة', 'Choose a service')}</b></legend>
        <div className="grid g2">{svcs.map((s) => (
          <button type="button" key={s.id} className={`card${svc?.id === s.id ? ' primary' : ''}`} aria-pressed={svc?.id === s.id} onClick={() => { setSvc(s); setStaffId(''); }} style={{ textAlign: 'start', cursor: 'pointer', outline: svc?.id === s.id ? '2px solid var(--color-primary)' : undefined }}>
            <b>{s.name}</b><div className="small muted">{s.durationMin} {t('دقيقة', 'min')} · {fmtMoney(s.price, currency, locale)}</div>{s.description && <div className="small muted">{s.description.slice(0, 100)}</div>}</button>))}
          {!svcs.length && <p className="muted">{t('لا توجد خدمات متاحة للحجز حاليًا.', 'No services are open for booking yet.')}</p>}</div></fieldset>
      {svc && <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}><legend><b>2. {t('اختر اليوم ومقدم الخدمة', 'Pick a day and a specialist')}</b></legend>
        <div className="row"><label className="field">{t('التاريخ', 'Date')}<input type="date" className="ltr" min={today()} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
          <label className="field">{t('مقدم الخدمة', 'Specialist')}<select value={staffId} onChange={(e) => { setStaffId(e.target.value); setSlot(null); }}><option value="">{t('أي متاح', 'Anyone available')}</option>{staffOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label></div></fieldset>}
      {svc && <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}><legend><b>3. {t('اختر الوقت', 'Pick a time')}</b></legend>
        {loading ? <p className="muted" aria-busy="true">{t('جارٍ تحميل المواعيد…', 'Loading times…')}</p> : !groups.length ? <p className="muted">{t('لا مواعيد متاحة في هذا اليوم، جرّب يومًا آخر.', 'Nothing free on this day — try another date.')}</p> : staffId || groups.length === 1 ?
          visible.map((g) => <div key={g.staffId} className="stack"><b className="small">{g.staffName}</b><div className="row" style={{ flexWrap: 'wrap' }}>{g.slots.map((tm) => <button type="button" key={tm} className={`btn sm${slot?.time === tm ? ' primary' : ''}`} aria-pressed={slot?.time === tm} onClick={() => setSlot({ staffId: g.staffId, time: tm })}>{tm}</button>)}</div></div>) :
          <div className="row" style={{ flexWrap: 'wrap' }}>{anyTimes.map((tm) => <button type="button" key={tm} className={`btn sm${slot?.time === tm ? ' primary' : ''}`} aria-pressed={slot?.time === tm} onClick={() => setSlot({ staffId: '', time: tm })}>{tm}</button>)}</div>}</fieldset>}
      {svc && slot && <form className="stack" onSubmit={submit}><b>4. {t('بياناتك', 'Your details')}</b>
        <div className="grid g2"><label className="field">{t('الاسم', 'Name')} *<input name="name" required minLength={2} autoComplete="name" /></label><label className="field">{t('الهاتف', 'Phone')} *<input name="phone" required type="tel" className="ltr" autoComplete="tel" /></label><label className="field">{t('البريد (اختياري)', 'Email (optional)')}<input name="email" type="email" className="ltr" /></label></div>
        <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hp" />
        <p className="small muted">{svc.name} · {date} · {slot.time} · {fmtMoney(svc.price, currency, locale)}</p>
        <div><button className="btn primary" disabled={busy}>{busy ? '…' : t('تأكيد الحجز', 'Confirm booking')}</button></div></form>}
      {err && <div className="alert error" role="alert">{err}</div>}
    </section>
  );
}

/** Look up a booking with code + phone, then cancel it or move it to another free slot. */
export function ManageBooking({ locale, currency, site }: { locale: Locale; currency: string; site?: string }) {
  const t = L(locale); const [auth, setAuth] = useState<{ code: string; phone: string } | null>(null); const [b, setB] = useState<any>(null); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [date, setDate] = useState(today()); const [groups, setGroups] = useState<Group[]>([]); const [serviceId, setServiceId] = useState('');
  async function lookup(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget); const a = { code: String(f.get('code')).trim().toUpperCase(), phone: String(f.get('phone')).trim() }; setErr(''); setMsg(''); setB(null);
    try { const r = await api<any>(`/public/actions/status?code=${encodeURIComponent(a.code)}&phone=${encodeURIComponent(a.phone)}`, { site }); setB(r.data); setAuth(a); setDate(r.data.date >= today() ? r.data.date : today()); }
    catch (x) { setErr((x as ApiError).message); }
  }
  useEffect(() => { // service id is not in the status payload: find it by name in the public catalogue
    if (!b) return; api<Svc[]>('/public/catalog/service?pageSize=100', { site }).then((r) => setServiceId(r.data.find((s) => s.name === b.service)?.id ?? '')).catch(() => {});
  }, [b, site]);
  useEffect(() => {
    if (!b || !auth || !serviceId || !['pending', 'confirmed'].includes(b.status)) return; let live = true;
    api<Group[]>(`/public/actions/availability?serviceId=${serviceId}&date=${date}&code=${auth.code}&phone=${encodeURIComponent(auth.phone)}`, { site }).then((r) => live && setGroups(r.data)).catch(() => live && setGroups([]));
    return () => { live = false; };
  }, [b, auth, serviceId, date, site]);
  const refresh = async () => { if (auth) setB((await api<any>(`/public/actions/status?code=${auth.code}&phone=${encodeURIComponent(auth.phone)}`, { site })).data); };
  async function act(kind: 'cancel' | 'reschedule', extra: object = {}) {
    if (!auth) return; setErr(''); setMsg('');
    try { await api(`/public/actions/${kind}`, { method: 'POST', site, body: { ...auth, ...extra } }); await refresh(); setMsg(kind === 'cancel' ? t('تم إلغاء الحجز.', 'Booking cancelled.') : t('تم تغيير الموعد.', 'Booking rescheduled.')); }
    catch (x) { setErr((x as ApiError).message); }
  }
  const active = b && ['pending', 'confirmed'].includes(b.status);
  return (
    <section className="card stack" aria-label={t('إدارة الحجز', 'Manage booking')}><h3>{t('متابعة حجزك أو تعديله', 'Track, change or cancel a booking')}</h3>
      <form className="row" onSubmit={lookup}><label className="field grow">{t('رقم الحجز', 'Booking code')}<input name="code" required className="ltr" placeholder="BK-0001" /></label><label className="field grow">{t('الهاتف', 'Phone')}<input name="phone" required type="tel" className="ltr" /></label><button className="btn">{t('بحث', 'Find')}</button></form>
      {err && <div className="alert error" role="alert">{err}</div>}{msg && <div className="alert ok" role="status">{msg}</div>}
      {b && <div className="stack"><dl className="dl"><dt>{t('الخدمة', 'Service')}</dt><dd>{b.service}</dd><dt>{t('الموعد', 'When')}</dt><dd className="mono">{b.date} · {b.startTime}–{b.endTime}</dd><dt>{t('الحالة', 'Status')}</dt><dd><b>{b.status}</b></dd><dt>{t('السعر', 'Price')}</dt><dd>{fmtMoney(b.price, currency, locale)}</dd>{b.cancelFee > 0 && <><dt>{t('رسوم الإلغاء', 'Cancellation fee')}</dt><dd>{fmtMoney(b.cancelFee, currency, locale)}</dd></>}</dl>
        {active && <><label className="field">{t('موعد جديد', 'New date')}<input type="date" className="ltr" min={today()} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
          {groups.map((g) => <div key={g.staffId} className="stack"><b className="small">{g.staffName}</b><div className="row" style={{ flexWrap: 'wrap' }}>{g.slots.map((tm) => <button type="button" key={tm} className="btn sm" onClick={() => act('reschedule', { date, startTime: tm, staffId: g.staffId })}>{tm}</button>)}</div></div>)}
          {!groups.length && <p className="muted small">{t('لا مواعيد متاحة في هذا اليوم.', 'No free times on this day.')}</p>}
          <div><button className="btn danger" onClick={async () => (await confirmDialog(t('هل تريد إلغاء الحجز؟ قد تُطبَّق رسوم حسب سياسة الإلغاء.', 'Cancel this booking? A fee may apply under the cancellation policy.'), { danger: true })) && act('cancel')}>{t('إلغاء الحجز', 'Cancel booking')}</button></div></>}</div>}
    </section>
  );
}
