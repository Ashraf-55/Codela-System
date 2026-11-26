'use client';
import { useState } from 'react';
import { fromMinor, toMinor } from '@codela/shared';
import { ApiError, api } from '@/lib/api';
import { PRODUCT_NAMES } from '@/lib/content';
import { ErrorBox, Loading, useAsync } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';

interface Plan { id: string; tier: string; priceMonthly: number; priceAnnual: number; currency: string; trialDays: number; limits: Record<string, number | boolean>; active: boolean }
function PlanRow({ p, onSaved }: { p: Plan; onSaved: () => void }) {
  const { t } = useI18n(); const [v, setV] = useState({ pm: fromMinor(p.priceMonthly, p.currency), pa: fromMinor(p.priceAnnual, p.currency), trial: String(p.trialDays), active: p.active, limits: p.limits }); const [msg, setMsg] = useState('');
  async function save() { setMsg(''); try { await api(`/platform/plans/${p.id}`, { method: 'PATCH', scope: 'platform', body: { priceMonthly: toMinor(v.pm, p.currency), priceAnnual: toMinor(v.pa, p.currency), trialDays: Number(v.trial), active: v.active, limits: v.limits } }); setMsg(t('saved')); onSaved(); } catch (e) { setMsg((e as ApiError).message || 'invalid'); } }
  return (
    <section className="card stack"><div className="row between"><b>{p.tier}</b><span className="muted small">{p.currency}</span></div>
      <div className="grid g4"><label className="field">{t('monthly')}<input className="ltr" value={v.pm} onChange={(e) => setV({ ...v, pm: e.target.value })} /></label><label className="field">{t('annual')}<input className="ltr" value={v.pa} onChange={(e) => setV({ ...v, pa: e.target.value })} /></label>
        <label className="field">{t('freeTrial')}<input className="ltr" value={v.trial} onChange={(e) => setV({ ...v, trial: e.target.value })} /></label><label className="field row"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />{t('active')}</label></div>
      <div className="grid g4">{Object.entries(v.limits).map(([k, x]) => <label key={k} className="field">{k}{typeof x === 'boolean' ? <input type="checkbox" checked={x} onChange={(e) => setV({ ...v, limits: { ...v.limits, [k]: e.target.checked } })} /> : <input className="ltr" value={String(x)} onChange={(e) => setV({ ...v, limits: { ...v.limits, [k]: Number(e.target.value) || 0 } })} />}</label>)}</div>
      <div className="row"><button className="btn primary" onClick={save}>{t('save')}</button><span className="small">{msg}</span></div></section>
  );
}
export default function Plans() {
  const { t, locale } = useI18n(); const [slug, setSlug] = useState('medical'); const res = useAsync(() => api<Plan[]>(`/platform/plans?productSlug=${slug}`, { scope: 'platform' }), [slug]);
  return (
    <><h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('plans')}</h1>
      <select value={slug} onChange={(e) => setSlug(e.target.value)} style={{ maxWidth: 320 }} aria-label={t('products')}>{Object.entries(PRODUCT_NAMES).map(([k, n]) => <option key={k} value={k}>{n[locale]}</option>)}</select>
      {res.error ? <ErrorBox error={res.error} retry={res.reload} /> : !res.data ? <Loading /> : res.data.data.map((p) => <PlanRow key={p.id + slug} p={p} onSaved={res.reload} />)}</>
  );
}
