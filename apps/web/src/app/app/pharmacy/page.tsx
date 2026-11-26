'use client';
import { useMemo, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { ErrorBox, Loading, useApp, useAsync } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';

interface Rec { id: string; code: string | null; data: Record<string, any> }
const norm = (x: unknown) => String(x ?? '').trim().toLowerCase();
const days = (iso: string) => Math.floor((new Date(`${iso}T00:00:00Z`).getTime() - Date.now()) / 86_400_000);

/** Pharmacist workspace: prescriptions waiting to be dispensed (matched to the medicine catalogue, with live stock), and stock / expiry alerts. */
export default function Pharmacy() {
  const app = useApp(); const { locale } = useI18n(); const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const list = (e: string, n = 100) => api<Rec[]>(`/tenant/p/${e}?pageSize=${n}&sort=createdAt&dir=desc`).then((r) => r.data);
  const meds = useAsync(() => list('medication'), []); const rx = useAsync(() => list('prescription', 50).catch(() => [] as Rec[]), []); const sold = useAsync(() => list('dispense'), []); const pts = useAsync(() => list('patient').catch(() => [] as Rec[]), []);
  const [qty, setQty] = useState<Record<string, number>>({}); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(''); const [pay, setPay] = useState('cash');
  const patient = useMemo(() => new Map((pts.data ?? []).map((p) => [p.id, p])), [pts.data]);
  if (!app.can('dispensing.read')) return <div className="alert warn" role="alert">{t('هذه الشاشة للصيدلية.', 'This screen is for the pharmacy.')}</div>;
  for (const r of [meds, rx, sold]) if (r.error) return <ErrorBox error={r.error} retry={r.reload} />; if (!meds.data || !rx.data || !sold.data) return <Loading />;
  const done = new Set(sold.data.filter((d) => d.data.status === 'dispensed' && d.data.prescriptionId).map((d) => String(d.data.prescriptionId)));
  const queue = rx.data.filter((r) => !done.has(r.id)); const find = (drug: string) => meds.data!.find((m) => m.data.active !== false && (norm(m.data.name) === norm(drug) || norm(m.data.name).includes(norm(drug)) || norm(drug).includes(norm(m.data.name))));
  const low = meds.data.filter((m) => m.data.reorderLevel !== undefined && Number(m.data.stock ?? 0) <= Number(m.data.reorderLevel));
  const expiring = meds.data.filter((m) => m.data.expiryDate && days(String(m.data.expiryDate)) <= 60).sort((a, b) => String(a.data.expiryDate).localeCompare(String(b.data.expiryDate)));
  async function dispense(r: Rec) {
    setBusy(r.id); setMsg(null);
    try {
      const items = (r.data.items as { drug: string }[]); const lines = items.map((i, k) => ({ medicationId: find(i.drug)!.id, qty: qty[`${r.id}:${k}`] ?? 1 }));
      await api('/tenant/p/dispense', { method: 'POST', body: { patientId: r.data.patientId, prescriptionId: r.id, paymentMethod: pay, lines } });
      setMsg({ ok: true, text: t('تم الصرف وخصم المخزون.', 'Dispensed and stock updated.') }); sold.reload(); meds.reload();
    } catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); } finally { setBusy(''); }
  }
  return (
    <>
      <h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('الصيدلية', 'Pharmacy')}</h1>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role="alert">{msg.text}</div>}
      <section className="card stack"><div className="row between"><h3>{t('طابور الصرف (روشتات لم تُصرف)', 'Dispensing queue (prescriptions not yet dispensed)')} <span className="badge">{queue.length}</span></h3>
        <label className="row small">{t('طريقة الدفع', 'Payment')}<select value={pay} onChange={(e) => setPay(e.target.value)} style={{ width: 'auto' }}><option value="cash">{t('نقدًا', 'Cash')}</option><option value="card">{t('بطاقة', 'Card')}</option></select></label></div>
        {!rx.data.length && !app.can('prescriptions.read') && <p className="muted">{t('ليس لديك صلاحية قراءة الروشتات.', 'You cannot read prescriptions.')}</p>}
        {!queue.length ? <p className="muted">{t('لا توجد روشتات في الانتظار.', 'No prescriptions waiting.')}</p> : queue.map((r) => { const items = (r.data.items as { drug: string; dose?: string; frequency?: string; days?: number }[]) ?? []; const matches = items.map((i) => find(i.drug)); const ok = matches.every(Boolean);
          return (
            <article key={r.id} className="card flat stack"><div className="row between"><b>{r.code} — {patient.get(String(r.data.patientId))?.data.name ?? String(r.data.patientId).slice(0, 8)}</b><button className="btn primary sm" disabled={!ok || busy === r.id || !app.can('dispensing.create')} onClick={() => dispense(r)}>{busy === r.id ? '…' : t('صرف', 'Dispense')}</button></div>
              <div className="table-wrap"><table><thead><tr><th scope="col">{t('الدواء بالروشتة', 'Prescribed')}</th><th scope="col">{t('الجرعة', 'Dose')}</th><th scope="col">{t('في الكتالوج', 'Catalogue match')}</th><th scope="col">{t('المخزون', 'Stock')}</th><th scope="col">{t('الكمية', 'Qty')}</th></tr></thead><tbody>{items.map((i, k) => { const m = matches[k]; const q = qty[`${r.id}:${k}`] ?? 1; return (
                <tr key={k}><td>{i.drug}</td><td className="small">{[i.dose, i.frequency, i.days ? `${i.days}d` : ''].filter(Boolean).join(' · ')}</td><td>{m ? m.data.name : <span className="badge bad">{t('غير موجود', 'Not in catalogue')}</span>}</td>
                  <td>{m ? <span className={`badge ${Number(m.data.stock ?? 0) >= q ? 'ok' : 'bad'}`}>{m.data.stock ?? 0}</span> : '—'}</td><td><input type="number" min={1} max={999} aria-label={`${t('الكمية', 'Qty')} ${i.drug}`} value={q} onChange={(e) => setQty({ ...qty, [`${r.id}:${k}`]: Math.max(1, Number(e.target.value) || 1) })} style={{ width: 80 }} /></td></tr>); })}</tbody></table></div>
              {!ok && <p className="small" style={{ color: 'var(--color-danger, #b91c1c)' }}>{t('أضف الأدوية الناقصة إلى كتالوج الأدوية ليمكن صرفها.', 'Add the missing medicines to the medication catalogue so they can be dispensed.')}</p>}</article>); })}</section>
      <div className="grid g2">
        <section className="card stack"><h3>{t('مخزون منخفض', 'Low stock')} <span className="badge">{low.length}</span></h3>{!low.length ? <p className="muted">{t('لا يوجد.', 'None.')}</p> : <ul style={{ margin: 0, paddingInlineStart: 18 }}>{low.map((m) => <li key={m.id}>{m.data.name} — <b className="mono">{m.data.stock ?? 0}</b> / {m.data.reorderLevel}</li>)}</ul>}</section>
        <section className="card stack"><h3>{t('الصلاحية', 'Expiry')} <span className="badge">{expiring.length}</span></h3>{!expiring.length ? <p className="muted">{t('لا توجد أدوية تنتهي خلال 60 يومًا.', 'Nothing expires within 60 days.')}</p> : <ul style={{ margin: 0, paddingInlineStart: 18 }}>{expiring.map((m) => { const d = days(String(m.data.expiryDate)); return <li key={m.id}>{m.data.name} {m.data.batchNo ? `(${m.data.batchNo})` : ''} — <span className={`badge ${d < 0 ? 'bad' : 'warn'}`}>{d < 0 ? t('منتهي', 'Expired') : `${d} ${t('يوم', 'days')}`}</span> <span className="mono small">{String(m.data.expiryDate)}</span></li>; })}</ul>}</section></div>
    </>
  );
}
