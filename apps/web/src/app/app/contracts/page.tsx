'use client';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { ErrorBox, Loading, useApp, useAsync } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';

interface Rec { id: string; code: string | null; data: Record<string, any> }

/** Estate: generate a printable sale or rental contract from a deal / rental record (parties, property, price, dates, standard clauses, signatures). A template to be reviewed by the business's lawyer — not legal advice. */
export default function Contracts() {
  const app = useApp(); const { locale } = useI18n(); const t = (ar: string, en: string) => (locale === 'ar' ? ar : en); const m = app.money;
  const get = (e: string) => api<Rec[]>(`/tenant/p/${e}?pageSize=100&sort=createdAt&dir=desc`).then((r) => r.data).catch(() => [] as Rec[]);
  const deals = useAsync(() => get('saleDeal'), []); const rentals = useAsync(() => get('rentalContract'), []); const props = useAsync(() => get('property'), []); const units = useAsync(() => get('unit'), []); const clients = useAsync(() => get('client'), []); const brokers = useAsync(() => get('broker'), []);
  const [tab, setTab] = useState<'sale' | 'rent'>('sale'); const [sel, setSel] = useState<{ kind: 'sale' | 'rent'; id: string } | null>(null);
  const by = (l: Rec[] | null) => new Map((l ?? []).map((x) => [x.id, x])); const P = useMemo(() => by(props.data), [props.data]); const U = useMemo(() => by(units.data), [units.data]); const C = useMemo(() => by(clients.data), [clients.data]); const B = useMemo(() => by(brokers.data), [brokers.data]);
  if (!app.can('sales.read') && !app.can('rentals.read')) return <div className="alert warn" role="alert">{t('لا تملك صلاحية عرض العقود.', 'You cannot view contracts.')}</div>;
  for (const r of [deals, rentals]) if (r.error) return <ErrorBox error={r.error} retry={r.reload} />; if (!deals.data || !rentals.data) return <Loading />;
  const list = tab === 'sale' ? deals.data : rentals.data; const rec = sel ? (sel.kind === 'sale' ? deals.data : rentals.data).find((x) => x.id === sel.id) : undefined;
  const subject = (r: Rec) => { const p = P.get(String(r.data.propertyId)); const u = U.get(String(r.data.unitId)); return p ? `${p.data.title}${p.data.address ? ` — ${p.data.address}` : ''}${p.data.area ? ` (${p.data.area} ${t('م²', 'm²')})` : ''}` : u ? `${t('وحدة', 'Unit')} ${u.data.unitNumber}${u.data.area ? ` (${u.data.area} ${t('م²', 'm²')})` : ''}` : '—'; };
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <div className="row between no-print"><h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('العقود', 'Contracts')}</h1><div className="row" role="tablist" aria-label={t('النوع', 'Type')}>{(['sale', 'rent'] as const).map((k) => <button key={k} role="tab" aria-selected={tab === k} className={`btn sm ${tab === k ? 'primary' : ''}`} onClick={() => { setTab(k); setSel(null); }}>{k === 'sale' ? t('عقود البيع', 'Sale contracts') : t('عقود الإيجار', 'Rental contracts')}</button>)}</div></div>
      {!list.length ? <div className="card no-print" style={{ textAlign: 'center' }}><p className="muted">{tab === 'sale' ? t('لا توجد صفقات بيع بعد.', 'No sale deals yet.') : t('لا توجد عقود إيجار بعد.', 'No rental contracts yet.')}</p></div> :
        <div className="table-wrap no-print"><table><thead><tr><th scope="col">{t('الكود', 'Code')}</th><th scope="col">{t('العقار', 'Property')}</th><th scope="col">{t('العميل', 'Client')}</th><th scope="col">{tab === 'sale' ? t('السعر', 'Price') : t('الإيجار الشهري', 'Monthly rent')}</th><th scope="col">{t('الحالة', 'Status')}</th><th /></tr></thead>
          <tbody>{list.map((r) => <tr key={r.id}><td className="mono">{r.code}</td><td>{subject(r)}</td><td>{C.get(String(r.data.clientId))?.data.name ?? '—'}</td><td className="mono">{m(Number(tab === 'sale' ? r.data.price : r.data.monthlyRent))}</td><td><span className="badge">{String(r.data.status)}</span></td><td><button className="btn sm primary" onClick={() => setSel({ kind: tab, id: r.id })}>{t('إنشاء العقد', 'Generate contract')}</button></td></tr>)}</tbody></table></div>}
      {rec && sel && (() => { const c = C.get(String(rec.data.clientId)); const br = B.get(String(rec.data.brokerId)); const sale = sel.kind === 'sale'; return (
        <article className="card stack print-area" aria-label={t('عقد للطباعة', 'Printable contract')} style={{ lineHeight: 1.9 }}>
          <div className="row between no-print"><span className="muted small">{t('نموذج عقد للمراجعة القانونية قبل الاستخدام.', 'A template — have it reviewed by your lawyer before use.')}</span><button className="btn primary" onClick={() => window.print()}>{t('طباعة / حفظ PDF', 'Print / Save as PDF')}</button></div>
          <h2 style={{ textAlign: 'center', margin: 0 }}>{sale ? t('عقد بيع', 'Sale contract') : t('عقد إيجار', 'Rental contract')}</h2><p style={{ textAlign: 'center', margin: 0 }} className="muted">{rec.code} — {today}</p>
          <p><b>{t('الطرف الأول (', 'First party (')}{sale ? t('البائع', 'Seller') : t('المؤجّر', 'Landlord')}):</b> {app.me.tenant.name}{br ? ` — ${t('ممثلًا بـ', 'represented by')} ${br.data.name}` : ''}</p>
          <p><b>{t('الطرف الثاني (', 'Second party (')}{sale ? t('المشتري', 'Buyer') : t('المستأجر', 'Tenant')}):</b> {c?.data.name ?? '—'}{c?.data.phone ? ` — ${c.data.phone}` : ''}{c?.data.email ? ` — ${c.data.email}` : ''}</p>
          <p><b>{t('العقار محل العقد:', 'Subject property:')}</b> {subject(rec)}</p>
          {sale ? <p><b>{t('الثمن:', 'Price:')}</b> {m(Number(rec.data.price))}</p> : <><p><b>{t('الإيجار الشهري:', 'Monthly rent:')}</b> {m(Number(rec.data.monthlyRent))} · <b>{t('التأمين:', 'Deposit:')}</b> {m(Number(rec.data.deposit ?? 0))}</p><p><b>{t('مدة الإيجار:', 'Term:')}</b> {t('من', 'from')} <span className="mono">{rec.data.startDate}</span> {t('إلى', 'to')} <span className="mono">{rec.data.endDate}</span></p></>}
          <ol style={{ paddingInlineStart: 22 }}>{(sale ? [t('يقرّ الطرف الأول بأن العقار خالٍ من أي حقوق للغير وقت التعاقد.', 'The seller declares the property free of third-party rights at signing.'), t('يلتزم المشتري بسداد الثمن وفق ما يُتفق عليه كتابةً.', 'The buyer pays the price according to the schedule agreed in writing.'), t('تنتقل الملكية بعد سداد كامل الثمن واستكمال إجراءات التسجيل.', 'Ownership transfers after full payment and registration formalities.')] : [t('يستخدم المستأجر العقار في الغرض المتفق عليه فقط ولا يؤجره من الباطن إلا بموافقة كتابية.', 'The tenant uses the property only for the agreed purpose and does not sub-let without written consent.'), t('تُسدَّد الأجرة في أول كل شهر، ويُردّ التأمين عند انتهاء العقد بعد معاينة العقار.', 'Rent is due on the first of each month; the deposit is returned at the end after inspection.'), t('يلتزم المستأجر بالمحافظة على العقار وإعادته بالحالة التي تسلّمه بها.', 'The tenant keeps the property in good condition and returns it as received.')]).map((x, i) => <li key={i}>{x}</li>)}</ol>
          <div className="grid g2" style={{ marginTop: 40 }}><div style={{ borderTop: '1px solid currentColor', paddingTop: 6 }}>{t('توقيع الطرف الأول', 'First party signature')}</div><div style={{ borderTop: '1px solid currentColor', paddingTop: 6 }}>{t('توقيع الطرف الثاني', 'Second party signature')}</div></div></article>); })()}
    </>
  );
}
