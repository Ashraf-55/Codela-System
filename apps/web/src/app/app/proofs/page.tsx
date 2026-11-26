'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { enumLabel } from '@/lib/i18n';
import { ErrorBox, Loading, useApp, useAsync, type Rec } from '@/components/app/AppShell';

/** Fleet: review delivered shipments with their proof (recipient, note, photo) and the cash the driver reported. */
export default function Proofs() {
  const app = useApp(); const t = (ar: string, en: string) => (app.locale === 'ar' ? ar : en); const [driver, setDriver] = useState(''); const [msg, setMsg] = useState('');
  const ships = useAsync<{ data: Rec[] }>(() => api<Rec[]>(`/tenant/p/shipment?status=delivered&pageSize=100&sort=createdAt&dir=desc${driver ? `&driverId=${driver}` : ''}`), [driver]);
  const drivers = useAsync<{ data: Rec[] }>(() => api<Rec[]>('/tenant/p/driver?pageSize=100'), []);
  const cash = useAsync<{ data: Rec[] }>(() => api<Rec[]>('/tenant/p/cashCollection?pageSize=200'), []);
  if (ships.error) return <ErrorBox error={ships.error} retry={ships.reload} />; if (!ships.data || !drivers.data || !cash.data) return <Loading />;
  const nameOf = new Map(drivers.data.data.map((d) => [d.id, String(d.data.name)])); const colOf = new Map(cash.data.data.map((c) => [String(c.data.shipmentId), c]));
  async function view(id: string) {
    setMsg(''); const x = await fetch(`/api/v1/tenant/fleet/shipments/${id}/proof`, { credentials: 'same-origin', cache: 'no-store' });
    if (!x.ok) { setMsg(t('لا توجد صورة إثبات لهذه الشحنة.', 'No proof photo for this shipment.')); return; } window.open(URL.createObjectURL(await x.blob()), '_blank', 'noopener');
  }
  return (
    <div className="stack"><h1>{t('إثباتات التسليم والتحصيل', 'Delivery proofs & collections')}</h1>
      <label className="field" style={{ maxWidth: 280 }}>{t('المندوب', 'Driver')}<select value={driver} onChange={(e) => setDriver(e.target.value)}><option value="">{t('الكل', 'All')}</option>{drivers.data.data.map((d) => <option key={d.id} value={d.id}>{String(d.data.name)}</option>)}</select></label>
      {msg && <div className="alert warn" role="alert">{msg}</div>}
      {ships.data.data.length === 0 ? <div className="card"><p className="muted">{t('لا توجد شحنات مسلّمة.', 'No delivered shipments.')}</p></div> : (
        <div className="table-wrap"><table><thead><tr><th>{t('الشحنة', 'Shipment')}</th><th>{t('المندوب', 'Driver')}</th><th>{t('المستلم', 'Received by')}</th><th>{t('ملاحظة', 'Note')}</th><th>{t('المحصّل', 'Collected')}</th><th>{t('تسوية النقدية', 'Cash status')}</th><th /></tr></thead>
          <tbody>{ships.data.data.map((s) => { const c = colOf.get(s.id); return (
            <tr key={s.id}><td className="mono">{s.code}</td><td>{nameOf.get(String(s.data.driverId)) ?? '—'}</td><td>{String(s.data.proofName ?? '—')}</td><td className="small">{String(s.data.proofNote ?? '')}</td>
              <td className="mono">{c ? app.money(Number(c.data.amount)) : '—'}</td><td>{c ? <span className="badge info">{enumLabel(String(c.data.status), app.locale)}</span> : '—'}</td>
              <td>{s.data.proofFileId ? <button className="btn sm" onClick={() => view(s.id)}>{t('عرض الصورة', 'View photo')}</button> : <span className="muted small">{t('بدون صورة', 'No photo')}</span>}</td></tr>); })}</tbody></table></div>)}
    </div>
  );
}
