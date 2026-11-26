'use client';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { enumLabel, type Locale } from '@/lib/i18n';

interface OrderItem { variantId: string; name: string; qty: number }
interface MyOrder { id: string; code: string | null; status: string; items?: OrderItem[] }
interface Ret { id: string; code: string; orderCode: string; status: string; reason: string }

/** Customer portal (e-commerce): ask to return items of a delivered order. The merchant approves; refunds are never decided here. */
export function ReturnsCard({ site, locale, orders }: { site?: string; locale: Locale; orders: MyOrder[] }) {
  const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const [list, setList] = useState<Ret[] | null>(null); const [open, setOpen] = useState(''); const [qty, setQty] = useState<Record<string, number>>({}); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<Ret[]>('/public/portal/returns', { site, scope: 'portal' }).then((r) => setList(r.data)).catch(() => setList([])), [site]);
  useEffect(() => { void load(); }, [load]);
  const delivered = orders.filter((o) => o.status === 'delivered');
  const openFor = (code: string | null) => (list ?? []).some((r) => r.orderCode === code && ['requested', 'approved', 'received'].includes(r.status));
  async function submit(e: React.FormEvent<HTMLFormElement>, o: MyOrder) {
    e.preventDefault(); const reason = String(new FormData(e.currentTarget).get('reason') ?? ''); setBusy(true); setMsg(null);
    const lines = (o.items ?? []).map((i) => ({ variantId: i.variantId, qty: Math.min(i.qty, Math.max(0, qty[`${o.id}|${i.variantId}`] ?? 0)) })).filter((l) => l.qty > 0);
    if (!lines.length) { setMsg({ ok: false, text: t('اختر كمية واحدة على الأقل.', 'Choose at least one quantity.') }); setBusy(false); return; }
    try { await api('/public/portal/returns', { method: 'POST', body: { orderId: o.id, reason, lines }, site, scope: 'portal' }); setMsg({ ok: true, text: t('تم إرسال طلب الإرجاع. سيراجعه المتجر.', 'Return request sent. The store will review it.') }); setOpen(''); await load(); }
    catch (x) { setMsg({ ok: false, text: (x as ApiError).message }); } finally { setBusy(false); }
  }
  return (
    <section className="card stack" aria-labelledby="rets"><h3 id="rets">{t('المرتجعات', 'Returns')}</h3>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      {(list ?? []).map((r) => <div key={r.id} className="row between"><span><b className="mono">{r.code}</b> · {r.orderCode}</span><span className="badge info">{enumLabel(r.status, locale)}</span></div>)}
      {delivered.length === 0 && <p className="muted small">{t('يمكنك طلب إرجاع بعد تسليم الطلب.', 'You can request a return once an order is delivered.')}</p>}
      {delivered.map((o) => (
        <div key={o.id} className="stack"><div className="row between"><b className="mono">{o.code}</b>{openFor(o.code) ? <span className="muted small">{t('يوجد طلب إرجاع قيد المعالجة', 'A return is in progress')}</span> : <button className="btn sm" onClick={() => setOpen(open === o.id ? '' : o.id)}>{t('طلب إرجاع', 'Request a return')}</button>}</div>
          {open === o.id && <form className="stack" onSubmit={(e) => submit(e, o)}>
            {(o.items ?? []).map((i) => <label key={i.variantId} className="row between small">{i.name} ({t('المطلوب', 'ordered')} {i.qty})<input type="number" min={0} max={i.qty} className="ltr" style={{ width: 80 }} value={qty[`${o.id}|${i.variantId}`] ?? 0} onChange={(e) => setQty((q) => ({ ...q, [`${o.id}|${i.variantId}`]: Number(e.target.value) }))} /></label>)}
            <label className="field">{t('سبب الإرجاع', 'Reason')} *<textarea name="reason" required minLength={3} maxLength={1000} /></label>
            <div><button className="btn primary" disabled={busy}>{busy ? '…' : t('إرسال الطلب', 'Send request')}</button></div></form>}
        </div>))}
    </section>
  );
}
