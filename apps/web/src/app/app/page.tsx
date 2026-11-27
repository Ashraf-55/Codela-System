'use client';
import Link from 'next/link';
import { api } from '@/lib/api';
import { enumLabel } from '@/lib/i18n';
import { ErrorBox, Loading, useApp, useAsync } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { MoneyFigure } from '@/components/app/Cells';

interface Dash { kpis: Record<string, number>; labels: Record<string, { en: string; ar: string; money: boolean }>; reports: { key: string; labelEn: string; labelAr: string; money: boolean; groupRef: string | null }[] }
function Report({ r }: { r: Dash['reports'][number] }) {
  const app = useApp(); const { locale } = useI18n(); const res = useAsync(() => api<{ key: string; value: number }[]>(`/tenant/reports/${r.key}`), [r.key]);
  useEffect(() => { app.ensureRefs([r.groupRef ?? undefined]); }, [r.groupRef, app]);
  const rows = res.data?.data ?? []; const max = Math.max(1, ...rows.map((x) => x.value));
  return (
    <section className="card stack" aria-label={locale === 'ar' ? r.labelAr : r.labelEn}><div className="row between"><h3 style={{ margin: 0 }}>{locale === 'ar' ? r.labelAr : r.labelEn}</h3><span className="kpi-icon" aria-hidden="true"><Icon name="chart" size={16} /></span></div>
      {res.error ? <ErrorBox error={res.error} /> : res.loading ? <div className="stack"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" style={{ width: '60%' }} /></div> : !rows.length ? <p className="muted small" style={{ margin: 0 }}>{locale === 'ar' ? 'لا توجد بيانات بعد — ستظهر هنا عند إضافة سجلات.' : 'No data yet. This fills in as you add records.'}</p> : (
        <div className="stack">{rows.slice(0, 8).map((x) => <div key={x.key}><div className="row between small"><span>{r.groupRef ? app.refTitle(r.groupRef, x.key) : enumLabel(x.key, locale)}</span><b className="mono">{r.money ? app.money(x.value) : new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-US').format(x.value)}</b></div><div className="bar"><i style={{ width: `${(x.value / max) * 100}%` }} /></div></div>)}</div>)}</section>
  );
}

const QUICK: Record<string, { href: string; ar: string; en: string }[]> = {
  booking: [{ href: '/app/calendar', ar: 'التقويم', en: 'Calendar' }, { href: '/app/e/appointment/new', ar: 'حجز جديد', en: 'New booking' }],
  medical: [{ href: '/app/calendar', ar: 'جدول المواعيد', en: 'Schedule' }, { href: '/app/e/appointment/new', ar: 'موعد جديد', en: 'New appointment' }, { href: '/app/e/patient/new', ar: 'مريض جديد', en: 'New patient' }],
  restaurant: [{ href: '/app/pos', ar: 'نقطة البيع', en: 'Point of sale' }, { href: '/app/board', ar: 'شاشة المطبخ', en: 'Kitchen display' }],
  ecommerce: [{ href: '/app/board', ar: 'مسار الطلبات', en: 'Order pipeline' }, { href: '/app/e/order/new', ar: 'طلب جديد', en: 'New order' }, { href: '/app/e/product/new', ar: 'منتج جديد', en: 'New product' }],
};
const CORE: Record<string, string[]> = {
  booking: ['service', 'staff', 'schedule'], medical: ['doctor', 'doctorSchedule', 'service'], restaurant: ['menuCategory', 'menuItem', 'restaurantTable'], ecommerce: ['category', 'product', 'shippingMethod'],
  realestate: ['property', 'broker'], learning: ['course', 'instructor'], construction: ['project', 'customer'], automotive: ['customer', 'vehicle', 'service'], fleet: ['driver', 'vehicle', 'shipmentRate'], business: ['customer', 'product'],
};
/** First-run checklist: branding, publish, and the few records every product needs before it is usable. Counts come from the real data. */
function GettingStarted() {
  const app = useApp(); const { locale } = useI18n(); const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const keys = (CORE[app.me.tenant.productSlug] ?? []).filter((k) => app.entity(k)); const [done, setDone] = useState<Record<string, boolean> | null>(null); const [published, setPublished] = useState<boolean | null>(null); const [hide, setHide] = useState(false);
  useEffect(() => { let live = true;
    void (async () => { const out: Record<string, boolean> = {}; for (const k of keys) { try { const r = await api<unknown[]>(`/tenant/p/${k}?pageSize=1`); out[k] = (r.meta?.total ?? r.data.length) > 0; } catch { out[k] = false; } }
      let pub = false; try { pub = !!(await api<{ publishedAt: string | null }>('/tenant/site')).data.publishedAt; } catch { /* no site permission */ } if (live) { setDone(out); setPublished(pub); } })();
    return () => { live = false; }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (hide || !done || published === null) return null;
  const steps = [{ ok: published, href: '/app/site', text: t('خصّص موقعك وانشره', 'Customise and publish your website') }, ...keys.map((k) => ({ ok: !!done[k], href: `/app/e/${k}/new`, text: `${t('أضف', 'Add')}: ${app.label(app.entity(k)!)}` }))];
  const left = steps.filter((x) => !x.ok).length; if (!left) return null;
  return (
    <section className="card stack" aria-label={t('ابدأ من هنا', 'Getting started')}><div className="row between"><h3 style={{ margin: 0 }}>{t('ابدأ من هنا', 'Getting started')} <span className="badge info">{steps.length - left}/{steps.length}</span></h3><button className="icon-btn" onClick={() => setHide(true)} aria-label={t('إخفاء', 'Dismiss')}><Icon name="x" size={16} /></button></div>
      <div className="bar"><i style={{ width: `${((steps.length - left) / steps.length) * 100}%` }} /></div>
      <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{steps.map((x, i) => <li key={i} className="row" style={{ gap: 10 }}><span aria-hidden="true" style={{ color: x.ok ? 'var(--ok)' : 'var(--subtle)', display: 'grid' }}><Icon name={x.ok ? 'checkCircle' : 'circle'} size={20} /></span>{x.ok ? <span className="muted" style={{ textDecoration: 'line-through' }}>{x.text}</span> : <Link href={x.href}><b>{x.text}</b></Link>}{x.ok && <span className="sr-only">{t('(تم)', '(done)')}</span>}</li>)}</ul></section>
  );
}
const greeting = (locale: string) => { const h = new Date().getHours(); return locale === 'ar' ? (h < 12 ? 'صباح الخير' : 'مساء الخير') : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
export default function Dashboard() {
  const app = useApp(); const { t, locale } = useI18n(); const res = useAsync(() => api<Dash>('/tenant/dashboard'), []);
  if (res.error) return <ErrorBox error={res.error} retry={res.reload} />; if (!res.data) return <Loading />;
  const d = res.data.data;
  return (
    <>
      <div className="page-head"><div><h1>{greeting(locale)}, {app.me.user.name.split(' ')[0]}</h1><p>{app.me.tenant.name} · {new Date().toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p></div>
        <div className="actions">{(QUICK[app.me.tenant.productSlug] ?? []).filter((q) => !q.href.includes('/e/') || app.entity(q.href.split('/')[3])?.canCreate).map((q, i) => <Link key={q.href} className={`btn${i === 0 ? ' primary' : ''}`} href={q.href}>{q.href.includes('/new') && <Icon name="plus" size={16} />}{locale === 'ar' ? q.ar : q.en}</Link>)}
          {!QUICK[app.me.tenant.productSlug] && app.entities.filter((e) => e.canCreate).slice(0, 3).map((e, i) => <Link key={e.key} className={`btn${i === 0 ? ' primary' : ''}`} href={`/app/e/${e.key}/new`}><Icon name="plus" size={16} />{app.label(e)}</Link>)}</div></div>
      <GettingStarted />
      <div className="kpi-grid">{Object.entries(d.kpis).map(([k, v]) => <div key={k} className="card kpi"><span>{d.labels[k][locale]}</span><b>{d.labels[k].money ? <MoneyFigure minor={v} /> : new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-US').format(v)}</b></div>)}</div>
      {d.reports.length > 0 && <h2 className="section-title">{t('reports')}</h2>}
      <div className="grid g2">{d.reports.map((r) => <Report key={r.key} r={r} />)}</div>
    </>
  );
}
