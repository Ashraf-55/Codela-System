'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { fmtMoney, type Locale } from '@/lib/i18n';

export interface ASvc { id: string; name: string; price?: number; durationMin?: number; description?: string }
export interface APart { id: string; sku: string; name: string; brand?: string; compatibility?: string; price: number; stock?: number }
const PAGE = 12;

/** Public site of a workshop / spare-parts store: services, a spare-parts catalogue filtered and paged ON THE SERVER, maintenance booking and quote requests. */
export function AutoSite({ services, initial, locale, currency, site }: { services: ASvc[]; initial: { rows: APart[]; total: number }; locale: Locale; currency: string; site?: string }) {
  const t = (ar: string, en: string) => (locale === 'ar' ? ar : en); const money = (n: number) => fmtMoney(n, currency, locale);
  const [q, setQ] = useState(''); const [brand, setBrand] = useState(''); const [sort, setSort] = useState<'name' | 'price' | '-price'>('name'); const [page, setPage] = useState(1);
  const [parts, setParts] = useState(initial); const [loading, setLoading] = useState(false); const [err, setErr] = useState('');
  const [kind, setKind] = useState<'booking' | 'quote'>('booking'); const [partId, setPartId] = useState(''); const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle'); const [formErr, setFormErr] = useState('');
  const first = useRef(true); const brands = Array.from(new Set(initial.rows.map((p) => p.brand).filter(Boolean) as string[]));

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE), sort: sort === 'name' ? 'name' : 'price', dir: sort === '-price' ? 'desc' : 'asc' }); if (q.trim()) qs.set('q', q.trim()); if (brand) qs.set('brand', brand);
      const r = await api<APart[]>(`/public/catalog/sparePart?${qs}`, { site }); setParts({ rows: r.data, total: r.meta?.total ?? r.data.length });
    } catch (x) { setErr((x as ApiError).message); } finally { setLoading(false); }
  }, [q, brand, sort, page, site]);
  useEffect(() => { if (first.current) { first.current = false; return; } const h = setTimeout(() => void load(), 250); return () => clearTimeout(h); }, [load]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget); const body: Record<string, unknown> = { website: f.get('website') }; setState('busy'); setFormErr('');
    for (const k of ['name', 'phone', 'plate', 'make', 'model', 'serviceId', 'preferredDate', 'preferredTime', 'message']) { const v = String(f.get(k) ?? '').trim(); if (v) body[k] = v; }
    if (kind === 'quote') { delete body.preferredDate; delete body.preferredTime; if (partId) body.partId = partId; }
    try { await api(`/public/forms/${kind}`, { method: 'POST', body, site }); setState('done'); } catch (x) { setFormErr((x as ApiError).message); setState('idle'); }
  }
  const pages = Math.max(1, Math.ceil(parts.total / PAGE)); const chosen = parts.rows.find((p) => p.id === partId);

  return (
    <>
      {services.length > 0 && <section id="services" className="block"><div className="container stack"><h2>{t('خدمات الصيانة', 'Maintenance services')}</h2>
        <div className="grid g3">{services.map((s) => <article key={s.id} className="card stack"><b>{s.name}</b>{s.description && <p className="muted small">{s.description}</p>}<div className="row between">{s.price !== undefined && <b className="mono">{money(s.price)}</b>}{s.durationMin ? <span className="muted small">{s.durationMin} {t('دقيقة', 'min')}</span> : null}</div>
          <button className="btn sm" onClick={() => { setKind('booking'); document.getElementById('auto-request')?.scrollIntoView({ behavior: 'smooth' }); }}>{t('احجز هذه الخدمة', 'Book this service')}</button></article>)}</div></div></section>}

      <section id="parts" className="block"><div className="container stack"><h2>{t('قطع الغيار والبطاريات', 'Spare parts & batteries')}</h2>
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="field grow">{t('ابحث بالاسم أو الكود أو الماركة أو موديل السيارة', 'Search by name, SKU, brand or car model')}<input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
          <label className="field">{t('الترتيب', 'Sort')}<select value={sort} onChange={(e) => { setSort(e.target.value as 'name'); setPage(1); }}><option value="name">{t('الاسم', 'Name')}</option><option value="price">{t('الأقل سعرًا', 'Price: low to high')}</option><option value="-price">{t('الأعلى سعرًا', 'Price: high to low')}</option></select></label></div>
        {brands.length > 0 && <div className="row" style={{ flexWrap: 'wrap' }} role="group" aria-label={t('الماركات', 'Brands')}><button className={`btn sm${!brand ? ' primary' : ''}`} aria-pressed={!brand} onClick={() => { setBrand(''); setPage(1); }}>{t('الكل', 'All')}</button>{brands.map((b) => <button key={b} className={`btn sm${brand === b ? ' primary' : ''}`} aria-pressed={brand === b} onClick={() => { setBrand(b); setPage(1); }}>{b}</button>)}</div>}
        {err && <div className="alert error" role="alert">{err}</div>}
        {!loading && parts.rows.length === 0 && <p className="muted">{t('لا توجد قطع مطابقة. اطلب عرض سعر وسنوفرها لك.', 'No matching parts. Request a quote and we will source it for you.')}</p>}
        <div className="grid g3" aria-busy={loading}>{parts.rows.map((p) => <article key={p.id} className="card stack"><div className="row between"><b>{p.name}</b><span className={`badge ${(p.stock ?? 0) > 0 ? ((p.stock ?? 0) <= 3 ? 'warn' : 'ok') : 'bad'}`}>{(p.stock ?? 0) > 0 ? ((p.stock ?? 0) <= 3 ? t('كمية محدودة', 'Low stock') : t('متوفر', 'In stock')) : t('غير متوفر', 'Out of stock')}</span></div>
          <span className="muted small mono">{p.sku}{p.brand ? ` · ${p.brand}` : ''}</span>{p.compatibility && <p className="small">{t('يناسب:', 'Fits:')} {p.compatibility}</p>}
          <div className="row between"><b className="mono">{money(p.price)}</b><button className="btn sm" onClick={() => { setKind('quote'); setPartId(p.id); document.getElementById('auto-request')?.scrollIntoView({ behavior: 'smooth' }); }}>{t('اطلب عرض سعر', 'Request a quote')}</button></div></article>)}</div>
        {pages > 1 && <div className="row between"><span className="muted small">{parts.total} {t('قطعة', 'parts')}</span><div className="row"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('السابق', 'Previous')}</button><span className="small">{page} / {pages}</span><button className="btn sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t('التالي', 'Next')}</button></div></div>}
      </div></section>

      <section id="auto-request" className="block"><div className="container stack" style={{ maxWidth: 680 }}>
        <h2>{kind === 'booking' ? t('احجز موعد صيانة', 'Book a maintenance appointment') : t('اطلب عرض سعر', 'Request a quote')}</h2>
        <div className="row" role="group" aria-label={t('نوع الطلب', 'Request type')}><button className={`btn sm${kind === 'booking' ? ' primary' : ''}`} aria-pressed={kind === 'booking'} onClick={() => setKind('booking')}>{t('حجز صيانة', 'Booking')}</button><button className={`btn sm${kind === 'quote' ? ' primary' : ''}`} aria-pressed={kind === 'quote'} onClick={() => setKind('quote')}>{t('عرض سعر', 'Quote')}</button></div>
        {state === 'done' ? <div className="alert ok" role="status">{kind === 'booking' ? t('وصلنا طلب الحجز وسنتواصل معك لتأكيد الموعد.', 'We received your booking request and will call to confirm.') : t('وصلنا طلب السعر وسنرد عليك قريبًا.', 'We received your quote request and will reply soon.')} <button className="btn sm" onClick={() => setState('idle')}>{t('طلب آخر', 'Another request')}</button></div> : (
          <form className="card stack" onSubmit={submit} noValidate>
            {formErr && <div className="alert error" role="alert">{formErr}</div>}
            <div className="grid g2"><label className="field">{t('الاسم', 'Name')} *<input name="name" required autoComplete="name" /></label><label className="field">{t('الهاتف', 'Phone')} *<input name="phone" required type="tel" className="ltr" autoComplete="tel" /></label></div>
            <div className="grid g3"><label className="field">{t('رقم اللوحة', 'Plate')}<input name="plate" className="ltr" maxLength={20} /></label><label className="field">{t('الماركة', 'Make')}<input name="make" /></label><label className="field">{t('الموديل', 'Model')}<input name="model" /></label></div>
            {services.length > 0 && <label className="field">{t('الخدمة', 'Service')}<select name="serviceId"><option value="">{t('اختر…', 'Choose…')}</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
            {kind === 'quote' && partId && <div className="alert info row between" role="status"><span>{t('القطعة:', 'Part:')} <b>{chosen?.name ?? partId}</b></span><button type="button" className="btn sm" onClick={() => setPartId('')}>{t('إزالة', 'Remove')}</button></div>}
            {kind === 'booking' && <div className="grid g2"><label className="field">{t('التاريخ المفضل', 'Preferred date')}<input name="preferredDate" type="date" className="ltr" min={new Date().toISOString().slice(0, 10)} /></label><label className="field">{t('الوقت المفضل', 'Preferred time')}<input name="preferredTime" type="time" className="ltr" /></label></div>}
            <label className="field">{kind === 'booking' ? t('وصف المشكلة', 'Describe the problem') : t('تفاصيل الطلب', 'Details')}<textarea name="message" /></label>
            <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', insetInlineStart: -9999, width: 1, height: 1 }} />
            <div><button className="btn primary" disabled={state === 'busy'}>{state === 'busy' ? '…' : t('إرسال', 'Send')}</button></div>
          </form>)}
      </div></section>
    </>
  );
}
