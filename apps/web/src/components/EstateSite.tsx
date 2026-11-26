'use client';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { fmtMoney, type Locale } from '@/lib/i18n';
import { EstateMap, validCoord } from '@/components/EstateMap';

interface Named { id: string; name: string }
export interface EProject { id: string; name: string; locationId?: string; developer?: string; description?: string; status?: string; deliveryDate?: string }
export interface EBroker { id: string; name: string; phone?: string; email?: string }
interface Prop { id: string; title: string; purpose: 'sale' | 'rent'; typeId?: string; locationId?: string; projectId?: string; price: number; area?: number; bedrooms?: number; bathrooms?: number; floor?: number; description?: string; features?: string; images?: { url: string; caption?: string }[]; featured?: boolean; address?: string; lat?: string; lng?: string; mapUrl?: string; mapEmbedUrl?: string; videoUrl?: string }
interface Unit { id: string; projectId: string; unitNumber: string; floor?: number; area?: number; bedrooms?: number; bathrooms?: number; price?: number }
type Target = { kind: 'propertyId' | 'unitId'; id: string; label: string };
const L = (locale: Locale) => (ar: string, en: string) => (locale === 'ar' ? ar : en);
const safeImg = (u?: string) => (u && (/^https:\/\//.test(u) || /^\/api\/v1\/public\/files\/[0-9a-f-]{36}$/.test(u)) ? u : undefined);
const safeEmbed = (u?: string) => (u && /^https:\/\/www\.google\.com\/maps\/embed\?[^\s"'<>]+$/.test(u) ? u : undefined);
const safeLink = (u?: string) => (u && /^https:\/\//.test(u) ? u : undefined);
const today = () => new Date().toISOString().slice(0, 10);
const STATUS: Record<string, [string, string]> = { planning: ['قيد التخطيط', 'Planning'], under_construction: ['قيد الإنشاء', 'Under construction'], ready: ['جاهز', 'Ready'], delivered: ['تم التسليم', 'Delivered'] };

/** Property search (location, type, price, area, bedrooms, sale/rent), listing details with gallery/map/video, projects with units, and a real viewing request that lands in the sales team's CRM. */
export function EstateSite({ locations, types, projects, brokers, locale, currency, site }: { locations: Named[]; types: Named[]; projects: EProject[]; brokers: EBroker[]; locale: Locale; currency: string; site?: string }) {
  const t = L(locale); const money = (n: number) => fmtMoney(n, currency, locale);
  const [purpose, setPurpose] = useState(''); const [typeId, setTypeId] = useState(''); const [locationId, setLocationId] = useState(''); const [projectId, setProjectId] = useState(''); const [q, setQ] = useState('');
  const [pFrom, setPFrom] = useState(''); const [pTo, setPTo] = useState(''); const [aFrom, setAFrom] = useState(''); const [beds, setBeds] = useState(''); const [sort, setSort] = useState('');
  const [rows, setRows] = useState<Prop[]>([]); const [page, setPage] = useState(1); const [total, setTotal] = useState(0); const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'map'>('list'); const [mapRows, setMapRows] = useState<Prop[]>([]); const [mapTotal, setMapTotal] = useState(0); const [cmp, setCmp] = useState<Prop[]>([]); const [open, setOpen] = useState<Prop | null>(null); const [gal, setGal] = useState(0); const [target, setTarget] = useState<Target | null>(null); const [unitsOf, setUnitsOf] = useState(''); const [units, setUnits] = useState<Unit[]>([]);
  const name = (list: Named[], id?: string) => list.find((x) => x.id === id)?.name;

  const load = useCallback(async (p: number, replace: boolean) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(p), pageSize: '12' });
      if (purpose) qs.set('purpose', purpose); if (typeId) qs.set('typeId', typeId); if (locationId) qs.set('locationId', locationId); if (projectId) qs.set('projectId', projectId); if (q.trim()) qs.set('q', q.trim());
      if (Number(pFrom) > 0) qs.set('price_from', String(Math.round(Number(pFrom) * 100))); if (Number(pTo) > 0) qs.set('price_to', String(Math.round(Number(pTo) * 100))); if (Number(aFrom) > 0) qs.set('area_from', String(Math.round(Number(aFrom)))); if (beds) qs.set('bedrooms_from', beds);
      if (sort) { const [f, d] = sort.split(':'); qs.set('sort', f); qs.set('dir', d); }
      const r = await api<Prop[]>(`/public/catalog/property?${qs}`, { site }); setRows((x) => (replace ? r.data : [...x, ...r.data])); setTotal(r.meta?.total ?? r.data.length); setPage(p);
    } finally { setLoading(false); }
  }, [purpose, typeId, locationId, projectId, q, pFrom, pTo, aFrom, beds, sort, site]);
  useEffect(() => { const id = setTimeout(() => void load(1, true), 300); return () => clearTimeout(id); }, [load]);
  // the map shows EVERY listing that matches the current filters (not only the visible page): up to 200, fetched 50 at a time
  useEffect(() => {
    if (view !== 'map') return; let dead = false;
    const id = setTimeout(async () => {
      const qs = new URLSearchParams({ pageSize: '50' }); if (purpose) qs.set('purpose', purpose); if (typeId) qs.set('typeId', typeId); if (locationId) qs.set('locationId', locationId); if (projectId) qs.set('projectId', projectId); if (q.trim()) qs.set('q', q.trim());
      if (Number(pFrom) > 0) qs.set('price_from', String(Math.round(Number(pFrom) * 100))); if (Number(pTo) > 0) qs.set('price_to', String(Math.round(Number(pTo) * 100))); if (Number(aFrom) > 0) qs.set('area_from', String(Number(aFrom))); if (beds) qs.set('bedrooms_from', beds);
      const out: Prop[] = []; let total = 0;
      try { for (let p = 1; p <= 4; p++) { const r = await api<Prop[]>(`/public/catalog/property?${qs}&page=${p}`, { site }); out.push(...r.data); total = r.meta?.total ?? out.length; if (out.length >= total || !r.data.length) break; } } catch { /* the list below still works */ }
      if (!dead) { setMapRows(out); setMapTotal(total); }
    }, 300);
    return () => { dead = true; clearTimeout(id); };
  }, [view, purpose, typeId, locationId, projectId, q, pFrom, pTo, aFrom, beds, site]);
  useEffect(() => { if (!unitsOf) { setUnits([]); return; } api<Unit[]>(`/public/catalog/unit?projectId=${unitsOf}&pageSize=50`, { site }).then((r) => setUnits(r.data)).catch(() => setUnits([])); }, [unitsOf, site]);

  const feats = (s?: string) => (s ?? '').split(/[\n,،]+/).map((x) => x.trim()).filter(Boolean).slice(0, 30);
  const specs = (p: { bedrooms?: number; bathrooms?: number; area?: number }) => [p.bedrooms != null ? `🛏 ${p.bedrooms}` : '', p.bathrooms != null ? `🛁 ${p.bathrooms}` : '', p.area ? `📐 ${p.area} ${t('م²', 'm²')}` : ''].filter(Boolean).join('  ·  ');

  return (
    <>
      <section id="properties" className="block"><div className="container stack"><h2>{t('ابحث عن عقارك', 'Find your property')}</h2>
        <div className="card stack">
          <div className="row" role="group" aria-label={t('الغرض', 'Purpose')}>{[['', t('الكل', 'All')], ['sale', t('للبيع', 'For sale')], ['rent', t('للإيجار', 'For rent')]].map(([v, l]) => <button key={v} className={`btn sm${purpose === v ? ' primary' : ''}`} aria-pressed={purpose === v} onClick={() => setPurpose(v)}>{l}</button>)}</div>
          <div className="grid g3">
            <label className="field">{t('المنطقة', 'Location')}<select value={locationId} onChange={(e) => setLocationId(e.target.value)}><option value="">{t('كل المناطق', 'Anywhere')}</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
            <label className="field">{t('النوع', 'Type')}<select value={typeId} onChange={(e) => setTypeId(e.target.value)}><option value="">{t('كل الأنواع', 'Any type')}</option>{types.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label className="field">{t('بحث بالكلمة', 'Keyword')}<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('مثال: حديقة، تشطيب…', 'e.g. garden, finished…')} /></label>
            <label className="field">{t('السعر من', 'Price from')}<input className="ltr" inputMode="decimal" value={pFrom} onChange={(e) => setPFrom(e.target.value)} /></label><label className="field">{t('السعر إلى', 'Price to')}<input className="ltr" inputMode="decimal" value={pTo} onChange={(e) => setPTo(e.target.value)} /></label>
            <label className="field">{t('مساحة من (م²)', 'Area from (m²)')}<input className="ltr" inputMode="numeric" value={aFrom} onChange={(e) => setAFrom(e.target.value)} /></label>
            <label className="field">{t('غرف النوم', 'Bedrooms')}<select value={beds} onChange={(e) => setBeds(e.target.value)}><option value="">{t('أي عدد', 'Any')}</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}+</option>)}</select></label>
            <label className="field">{t('الترتيب', 'Sort')}<select value={sort} onChange={(e) => setSort(e.target.value)}><option value="">{t('الأحدث', 'Newest')}</option><option value="price:asc">{t('السعر: الأقل', 'Price: low to high')}</option><option value="price:desc">{t('السعر: الأعلى', 'Price: high to low')}</option><option value="area:desc">{t('المساحة: الأكبر', 'Area: largest')}</option></select></label>
            {!!projects.length && <label className="field">{t('المشروع', 'Project')}<select value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">{t('كل المشروعات', 'All projects')}</option>{projects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
          </div>
          <p className="small muted" role="status">{loading ? t('جارٍ البحث…', 'Searching…') : `${total} ${t('نتيجة', 'results')}`}</p>
          <div className="row" role="group" aria-label={t('طريقة العرض', 'View')}>{([['list', t('قائمة', 'List')], ['map', t('خريطة', 'Map')]] as const).map(([k, l]) => <button key={k} type="button" className={`btn sm${view === k ? ' primary' : ''}`} aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>)}</div>
        </div>
        {view === 'map' ? <div className="stack">
          <EstateMap rows={mapRows} href={(id) => `/sites/${site ?? '_host'}/properties/${id}`} money={money} locale={locale} />
          <p className="small muted" role="status" data-testid="map-status">{(() => { const n = mapRows.filter((r) => validCoord(r.lat, r.lng)).length; const miss = mapRows.length - n; return locale === 'ar' ? `${n} عقار على الخريطة${miss ? ` — ${miss} بدون موقع محدد (متاحة في القائمة)` : ''}` : `${n} listing${n === 1 ? '' : 's'} on the map${miss ? ` — ${miss} without a location (see the list)` : ''}`; })()}{mapTotal > mapRows.length ? (locale === 'ar' ? ' · تم عرض أول 200 نتيجة، ضيّق البحث لرؤية الباقي' : ' · showing the first 200 matches; narrow the search for the rest') : ''}</p></div> : !loading && !rows.length ? <p className="muted">{t('لا توجد عقارات مطابقة. جرّب تغيير الفلاتر.', 'No matching properties. Try changing the filters.')}</p> :
          <div className="grid g3">{rows.map((p) => { const im = safeImg(p.images?.[0]?.url); return (
            <article key={p.id} className="card cat-card stack" style={{ textAlign: 'start', padding: 0, overflow: 'hidden' }}>
              <button type="button" onClick={() => { setOpen(p); setGal(0); }} style={{ all: 'unset', cursor: 'pointer', display: 'block' }} aria-label={p.title}>
                <div style={{ aspectRatio: '4 / 3', background: 'var(--surface-2, #e5e5e5)', position: 'relative' }}>{im ? <img src={im} alt={p.images?.[0]?.caption || p.title} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span className="brand-mark" aria-hidden="true" style={{ width: '100%', height: '100%', borderRadius: 0, fontSize: 48 }}>🏠</span>}
                  <span className="badge info" style={{ position: 'absolute', top: 8, insetInlineStart: 8 }}>{p.purpose === 'sale' ? t('للبيع', 'For sale') : t('للإيجار', 'For rent')}</span>{p.featured && <span className="badge ok" style={{ position: 'absolute', top: 8, insetInlineEnd: 8 }}>★ {t('مميز', 'Featured')}</span>}</div>
                <div className="stack" style={{ padding: 14, gap: 4 }}><b>{p.title}</b><span className="small muted">{name(locations, p.locationId)}{name(types, p.typeId) ? ` · ${name(types, p.typeId)}` : ''}</span><b className="mono" style={{ fontSize: '1.15rem' }}>{money(p.price)}{p.purpose === 'rent' ? <span className="small muted"> / {t('شهر', 'mo')}</span> : null}</b><span className="small">{specs(p)}</span></div></button>
              <div className="row between" style={{ padding: '0 14px 12px' }}><label className="row small"><input type="checkbox" checked={cmp.some((x) => x.id === p.id)} disabled={!cmp.some((x) => x.id === p.id) && cmp.length >= 3} onChange={(e) => setCmp((c) => (e.target.checked ? [...c, p].slice(0, 3) : c.filter((x) => x.id !== p.id)))} />{t('قارن', 'Compare')}</label><a className="small" href={`/sites/${site ?? '_host'}/properties/${p.id}`}>{t('صفحة العقار ↗', 'Property page ↗')}</a></div>
            </article>); })}</div>}
        {view === 'list' && rows.length < total && <div><button className="btn" disabled={loading} onClick={() => void load(page + 1, false)}>{t('عرض المزيد', 'Load more')}</button></div>}
      </div></section>

      {!!projects.length && <section id="projects" className="block"><div className="container stack"><h2>{t('المشروعات والكمبوندات', 'Projects & compounds')}</h2>
        <div className="grid g2">{projects.map((pr) => (
          <article key={pr.id} className="card cat-card stack" style={{ textAlign: 'start' }}><div className="row between"><h3 style={{ margin: 0 }}>{pr.name}</h3>{pr.status && STATUS[pr.status] && <span className="badge info">{t(...STATUS[pr.status])}</span>}</div>
            <p className="small muted">{[name(locations, pr.locationId), pr.developer, pr.deliveryDate ? `${t('التسليم', 'Delivery')} ${pr.deliveryDate}` : ''].filter(Boolean).join(' · ')}</p>{pr.description && <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{pr.description}</p>}
            <div className="row"><button className="btn sm" aria-expanded={unitsOf === pr.id} onClick={() => setUnitsOf(unitsOf === pr.id ? '' : pr.id)}>{t('الوحدات المتاحة', 'Available units')}</button><button className="btn sm" onClick={() => { setProjectId(pr.id); document.getElementById('properties')?.scrollIntoView({ behavior: 'smooth' }); }}>{t('عقارات المشروع', 'Project listings')}</button></div>
            {unitsOf === pr.id && (units.length ? <table className="small"><tbody>{units.map((u) => <tr key={u.id}><td><b>{u.unitNumber}</b></td><td>{specs(u)}</td><td className="mono">{u.price ? money(u.price) : ''}</td><td><button className="btn sm primary" onClick={() => setTarget({ kind: 'unitId', id: u.id, label: `${pr.name} — ${u.unitNumber}` })}>{t('معاينة', 'View')}</button></td></tr>)}</tbody></table> : <p className="small muted">{t('لا توجد وحدات متاحة حاليًا.', 'No units available right now.')}</p>)}</article>))}</div></div></section>}

      {!!brokers.length && <section id="agents" className="block"><div className="container stack"><h2>{t('فريق المبيعات', 'Our agents')}</h2><div className="grid g3">{brokers.map((b) => <article key={b.id} className="card cat-card stack" style={{ textAlign: 'start' }}><div className="row"><span className="brand-mark" aria-hidden="true" style={{ borderRadius: '50%' }}>{b.name.slice(0, 1)}</span><b>{b.name}</b></div>{b.phone && <a className="mono small" href={`tel:${b.phone}`}>{b.phone}</a>}{b.email && <a className="small" href={`mailto:${b.email}`}>{b.email}</a>}</article>)}</div></div></section>}

      {cmp.length > 0 && <section className="card stack" aria-label={t('مقارنة العقارات', 'Compare properties')} style={{ margin: '0 auto', maxWidth: 1100 }}>
        <div className="row between"><h3>{t('مقارنة العقارات', 'Compare properties')} ({cmp.length}/3)</h3><button className="btn sm" onClick={() => setCmp([])}>{t('مسح', 'Clear')}</button></div>
        {cmp.length < 2 ? <p className="small muted">{t('اختر عقارًا آخر على الأقل للمقارنة.', 'Pick at least one more property to compare.')}</p> :
          <div className="table-wrap"><table><thead><tr><th scope="col" /> {cmp.map((p) => <th key={p.id} scope="col"><a href={`/sites/${site ?? '_host'}/properties/${p.id}`}>{p.title}</a></th>)}</tr></thead><tbody>
            {([[t('الغرض', 'Purpose'), (p: Prop) => (p.purpose === 'sale' ? t('بيع', 'Sale') : t('إيجار', 'Rent'))], [t('السعر', 'Price'), (p: Prop) => money(p.price)], [t('المساحة (م²)', 'Area (m²)'), (p: Prop) => p.area ?? '—'], [t('سعر المتر', 'Price per m²'), (p: Prop) => (p.area ? money(Math.round(p.price / p.area)) : '—')], [t('غرف النوم', 'Bedrooms'), (p: Prop) => p.bedrooms ?? '—'], [t('الحمامات', 'Bathrooms'), (p: Prop) => p.bathrooms ?? '—'], [t('الدور', 'Floor'), (p: Prop) => p.floor ?? '—'], [t('المنطقة', 'Location'), (p: Prop) => name(locations, p.locationId) ?? '—'], [t('النوع', 'Type'), (p: Prop) => name(types, p.typeId) ?? '—']] as [string, (p: Prop) => React.ReactNode][]).map(([k, f]) => <tr key={k}><th scope="row">{k}</th>{cmp.map((p) => <td key={p.id} className="mono">{f(p)}</td>)}</tr>)}</tbody></table></div>}</section>}

      {open && <div className="card stack" role="dialog" aria-label={open.title} style={{ borderWidth: 2, margin: '0 auto', maxWidth: 1100 }}>
        <div className="row between"><h3>{open.title}</h3><button className="btn sm" onClick={() => setOpen(null)} aria-label={t('إغلاق', 'Close')}>✕</button></div>
        <div className="grid g2" style={{ alignItems: 'start' }}>
          <div className="stack">{safeImg(open.images?.[gal]?.url) ? <img src={safeImg(open.images?.[gal]?.url)} alt={open.images?.[gal]?.caption || open.title} style={{ width: '100%', maxHeight: 420, objectFit: 'cover', borderRadius: 12 }} /> : <div className="brand-mark" style={{ width: '100%', height: 220, borderRadius: 12, fontSize: 64 }}>🏠</div>}
            {(open.images?.length ?? 0) > 1 && <div className="row" style={{ flexWrap: 'wrap' }}>{open.images!.map((im, i) => safeImg(im.url) && <button key={i} type="button" onClick={() => setGal(i)} aria-label={`${t('صورة', 'Image')} ${i + 1}`} style={{ all: 'unset', cursor: 'pointer', outline: gal === i ? '2px solid var(--color-primary)' : 'none', borderRadius: 6 }}><img src={safeImg(im.url)} alt="" width={64} height={48} style={{ objectFit: 'cover', borderRadius: 6 }} /></button>)}</div>}
            {safeEmbed(open.mapEmbedUrl) ? <iframe title={t('الموقع على الخريطة', 'Map')} src={safeEmbed(open.mapEmbedUrl)} width="100%" height="260" style={{ border: 0, borderRadius: 12 }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" /> : null}</div>
          <div className="stack"><b className="mono" style={{ fontSize: '1.5rem' }}>{money(open.price)}{open.purpose === 'rent' ? ` / ${t('شهر', 'mo')}` : ''}</b>
            <p className="muted">{[name(locations, open.locationId), name(types, open.typeId), open.address].filter(Boolean).join(' · ')}</p><p>{specs(open)}{open.floor != null ? `  ·  ${t('الدور', 'Floor')} ${open.floor}` : ''}</p>
            {open.description && <p style={{ whiteSpace: 'pre-wrap' }}>{open.description}</p>}{!!feats(open.features).length && <ul className="small">{feats(open.features).map((f, i) => <li key={i}>{f}</li>)}</ul>}
            <div className="row">{safeLink(open.mapUrl) && <a className="btn sm" href={safeLink(open.mapUrl)} target="_blank" rel="noopener noreferrer">{t('افتح الخريطة', 'Open map')}</a>}{safeLink(open.videoUrl) && <a className="btn sm" href={safeLink(open.videoUrl)} target="_blank" rel="noopener noreferrer">{t('شاهد الفيديو', 'Watch video')}</a>}</div>
            <div><button className="btn primary" onClick={() => setTarget({ kind: 'propertyId', id: open.id, label: open.title })}>{t('اطلب معاينة', 'Request a viewing')}</button></div></div></div></div>}

      {target && <ViewingForm target={target} locale={locale} site={site} onClose={() => setTarget(null)} />}
    </>
  );
}

/** Button + form used by the stand-alone property page. */
export function ViewingButton({ id, label, locale, site }: { id: string; label: string; locale: Locale; site?: string }) {
  const t = L(locale); const [on, setOn] = useState(false);
  return <div className="stack">{!on && <div><button className="btn primary" onClick={() => setOn(true)}>{t('اطلب معاينة', 'Request a viewing')}</button></div>}{on && <ViewingForm target={{ kind: 'propertyId', id, label }} locale={locale} site={site} onClose={() => setOn(false)} />}</div>;
}

function ViewingForm({ target, locale, site, onClose }: { target: Target; locale: Locale; site?: string; onClose: () => void }) {
  const t = L(locale); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState<{ code: string; date: string } | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); setErr('');
    try { const r = await api<{ code: string; date: string }>('/public/actions/viewingRequest', { method: 'POST', site, body: { [target.kind]: target.id, visitor: { name: f.get('name'), phone: f.get('phone'), email: f.get('email') || undefined }, date: f.get('date'), startTime: f.get('time') || undefined, message: f.get('message') || undefined } }); setDone(r.data); }
    catch (x) { setErr((x as ApiError).message); } finally { setBusy(false); }
  }
  return (
    <div className="card stack" role="dialog" aria-label={t('طلب معاينة', 'Request a viewing')} style={{ borderWidth: 2, margin: '16px auto', maxWidth: 640 }}>
      <div className="row between"><h3>{t('طلب معاينة', 'Request a viewing')} — {target.label}</h3><button className="btn sm" onClick={onClose} aria-label={t('إغلاق', 'Close')}>✕</button></div>
      {done ? <div className="alert ok stack" role="status"><b>{t('تم استلام طلبك ✔', 'Request received ✔')}</b><span>{t('رقم الطلب', 'Request code')}: <b className="mono">{done.code}</b> · {done.date}</span><span className="small">{t('سيتواصل معك فريق المبيعات لتأكيد الموعد.', 'Our sales team will contact you to confirm the time.')}</span></div> :
        <form className="stack" onSubmit={submit}><div className="grid g2"><label className="field">{t('الاسم', 'Name')} *<input name="name" required minLength={2} autoComplete="name" /></label><label className="field">{t('الهاتف', 'Phone')} *<input name="phone" required type="tel" className="ltr" autoComplete="tel" /></label>
          <label className="field">{t('البريد (اختياري)', 'Email (optional)')}<input name="email" type="email" className="ltr" /></label><label className="field">{t('التاريخ المفضل', 'Preferred date')} *<input name="date" required type="date" className="ltr" min={today()} /></label><label className="field">{t('الوقت المفضل', 'Preferred time')}<input name="time" type="time" className="ltr" /></label></div>
          <label className="field">{t('ملاحظات', 'Notes')}<textarea name="message" rows={2} maxLength={500} /></label><div><button className="btn primary" disabled={busy}>{busy ? '…' : t('إرسال الطلب', 'Send request')}</button></div>{err && <div className="alert error" role="alert">{err}</div>}</form>}
    </div>
  );
}
