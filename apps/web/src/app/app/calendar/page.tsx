'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { enumLabel } from '@/lib/i18n';
import { ErrorBox, Loading, useApp, useAsync, type Rec } from '@/components/app/AppShell';

type View = 'day' | 'week' | 'month';
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const startOfWeek = (d: Date) => addDays(d, -d.getUTCDay());
const COLOR: Record<string, string> = { pending: '#b45309', scheduled: '#b45309', confirmed: '#0f766e', completed: '#475569', cancelled: '#b91c1c', no_show: '#7c2d12' };

/** which fields/entities hold the provider and the person for each product's appointments */
const CFG: Record<string, { staff: string; person: string; staffEntity: string; personEntity: string }> = {
  booking: { staff: 'staffId', person: 'customerId', staffEntity: 'staff', personEntity: 'customer' },
  medical: { staff: 'doctorId', person: 'patientId', staffEntity: 'doctor', personEntity: 'patient' },
};
async function loadAll(): Promise<Rec[]> {
  const out: Rec[] = []; for (let p = 1; p <= 20; p++) { const r = await api<Rec[]>(`/tenant/p/appointment?page=${p}&pageSize=100`); out.push(...r.data); if (out.length >= (r.meta?.total ?? 0)) break; } return out;
}
/** Salon calendar: day / week / month over real bookings, filterable by staff and branch; every chip opens the booking. */
export default function CalendarPage() {
  const app = useApp(); const { locale } = app; const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const [view, setView] = useState<View>('week'); const [cursor, setCursor] = useState(() => parse(iso(new Date()))); const [staff, setStaff] = useState(''); const [hideDone, setHideDone] = useState(false);
  const res = useAsync(loadAll, []);
  const cfg = CFG[app.me.tenant.productSlug];
  useMemo(() => { if (cfg) app.ensureRefs([cfg.staffEntity, 'service', cfg.personEntity]); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!cfg) return <div className="alert error">404</div>;
  if (res.error) return <ErrorBox error={res.error} retry={res.reload} />; if (!res.data) return <Loading />;
  const rows = res.data.filter((r) => (!staff || r.data[cfg.staff] === staff) && !(hideDone && ['cancelled', 'no_show', 'completed'].includes(r.data.status)));
  const byDate = (d: string) => rows.filter((r) => r.data.date === d).sort((a, b) => String(a.data.startTime).localeCompare(String(b.data.startTime)));
  const days = view === 'day' ? [cursor] : view === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(cursor), i)) : (() => { const first = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1)); const s = startOfWeek(first); return Array.from({ length: 42 }, (_, i) => addDays(s, i)); })();
  const step = (n: number) => setCursor(view === 'month' ? new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + n, 1)) : addDays(cursor, n * (view === 'week' ? 7 : 1)));
  const title = cursor.toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric', ...(view === 'day' ? { day: 'numeric', weekday: 'long' } : {}) });
  const chip = (r: Rec) => (
    <Link key={r.id} href={`/app/e/appointment/${r.id}`} className="small" title={enumLabel(r.data.status, locale)} style={{ display: 'block', borderInlineStart: `4px solid ${COLOR[r.data.status] ?? '#64748b'}`, padding: '3px 6px', background: 'var(--color-surface-2, rgba(100,116,139,.12))', borderRadius: 4, textDecoration: 'none', color: 'inherit', textDecorationLine: ['cancelled', 'no_show'].includes(r.data.status) ? 'line-through' : 'none' }}>
      <b className="mono">{r.data.startTime}</b> {app.refTitle('service', r.data.serviceId)} <span className="muted">· {app.refTitle(cfg.personEntity, r.data[cfg.person])}{view !== 'month' ? ` · ${app.refTitle(cfg.staffEntity, r.data[cfg.staff])}` : ''}</span></Link>);
  return (
    <>
      <div className="row between"><h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('التقويم', 'Calendar')} — {title}</h1>
        <div className="row"><button className="btn sm" onClick={() => step(-1)} aria-label={t('السابق', 'Previous')}>‹</button><button className="btn sm" onClick={() => setCursor(parse(iso(new Date())))}>{t('اليوم', 'Today')}</button><button className="btn sm" onClick={() => step(1)} aria-label={t('التالي', 'Next')}>›</button>
          {(['day', 'week', 'month'] as View[]).map((v) => <button key={v} className={`btn sm${view === v ? ' primary' : ''}`} aria-pressed={view === v} onClick={() => setView(v)}>{v === 'day' ? t('يوم', 'Day') : v === 'week' ? t('أسبوع', 'Week') : t('شهر', 'Month')}</button>)}</div></div>
      <div className="row"><select value={staff} onChange={(e) => setStaff(e.target.value)} aria-label={t('مقدم الخدمة', 'Provider')} style={{ width: 'auto' }}><option value="">{t('الكل', 'Everyone')}</option>{app.refOptions(cfg.staffEntity).map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}</select>
        <label className="row small"><input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> {t('إخفاء المنتهي والملغي', 'Hide finished / cancelled')}</label>
        {app.entity('appointment')?.canCreate && <Link className="btn sm primary" href="/app/e/appointment/new">{t('حجز جديد', 'New booking')}</Link>}
        <span className="row small">{Object.keys(COLOR).map((s) => <span key={s} className="row" style={{ gap: 4 }}><i style={{ width: 10, height: 10, background: COLOR[s], display: 'inline-block', borderRadius: 2 }} />{enumLabel(s, locale)}</span>)}</span></div>
      <div className="grid" style={{ gridTemplateColumns: view === 'day' ? '1fr' : 'repeat(7, minmax(0, 1fr))', gap: 6, overflowX: 'auto' }}>
        {view !== 'day' && days.slice(0, 7).map((d) => <b key={'h' + d.getTime()} className="small muted" style={{ textAlign: 'center' }}>{d.toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { timeZone: 'UTC', weekday: 'short' })}</b>)}
        {days.map((d) => { const k = iso(d), list = byDate(k), out = view === 'month' && d.getUTCMonth() !== cursor.getUTCMonth(), isToday = k === iso(new Date());
          return (<div key={k} className="card stack" style={{ padding: 8, gap: 4, minHeight: view === 'month' ? 96 : 160, opacity: out ? 0.45 : 1, outline: isToday ? '2px solid var(--color-primary)' : undefined }}>
            <button className="btn sm" style={{ alignSelf: 'start' }} onClick={() => { setCursor(d); setView('day'); }}>{d.getUTCDate()}</button>
            {list.slice(0, view === 'month' ? 3 : 50).map(chip)}{view === 'month' && list.length > 3 && <span className="small muted">+{list.length - 3}</span>}
            {view === 'day' && !list.length && <p className="muted small">{t('لا حجوزات في هذا اليوم.', 'No bookings on this day.')}</p>}</div>); })}
      </div>
    </>
  );
}
