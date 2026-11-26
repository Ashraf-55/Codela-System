'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { BOARDS } from '@/lib/boards';
import { enumLabel, fieldLabel } from '@/lib/i18n';
import { ErrorBox, Loading, useApp, useAsync, type Rec } from '@/components/app/AppShell';

export default function Board() {
  const app = useApp(); const { locale } = app; const which = useSearchParams().get('b'); const cfg = (which && BOARDS[`${app.me.tenant.productSlug}:${which}`]) || BOARDS[app.me.tenant.productSlug];
  const def = cfg && app.entity(cfg.entity);
  const res = useAsync<{ data: Rec[] }>(() => (cfg ? api<Rec[]>(`/tenant/p/${cfg.entity}?pageSize=100`) : Promise.resolve({ data: [] as Rec[] })), [cfg?.entity]);
  useEffect(() => { if (!cfg || !['restaurant', 'fleet'].includes(app.me.tenant.productSlug)) return; const i = setInterval(() => res.reload(), 10000); return () => clearInterval(i); }, [cfg?.entity]); // eslint-disable-line react-hooks/exhaustive-deps
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState<string | null>(null);
  const [ship, setShip] = useState<Record<string, { carrier: string; tracking: string }>>({});
  useEffect(() => { if (cfg) app.ensureRefs(cfg.refs.map(([, e]) => e)); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cfg?.entity]);
  if (!cfg || !def) return <div className="card stack"><p className="muted">{locale === 'ar' ? 'لا توجد لوحة عمل لهذا المنتج بعد.' : 'No work board for this product yet.'}</p><Link className="btn" href="/app">{locale === 'ar' ? 'الرئيسية' : 'Dashboard'}</Link></div>;
  if (res.error) return <ErrorBox error={res.error} retry={res.reload} />; if (!res.data) return <Loading />;

  const today = new Date().toLocaleDateString('en-CA', { timeZone: undefined });
  const rows = res.data.data.filter((r) => !cfg.today || r.data.date === today);
  const canUpdate = def.canUpdate;
  const move = async (r: Rec, status: string, extra: Record<string, unknown> = {}) => {
    setMsg(null); setBusy(r.id);
    try { await api(`/tenant/p/${cfg.entity}/${r.id}`, { method: 'PATCH', body: { [cfg.statusField ?? 'status']: status, ...extra } }); setMsg({ ok: true, text: `${r.code ?? ''} → ${enumLabel(status, locale)}` }); res.reload(); }
    catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); } finally { setBusy(null); }
  };
  const markPaid = async (r: Rec) => {
    if (!cfg.payable) return; setMsg(null); setBusy(r.id);
    try {
      const rec = cfg.payable.record;
      if (rec) { // a real payment record (it also settles the order once the payments add up to the total)
        let method = 'cash'; const mid = rec.methodRefField ? String(r.data[rec.methodRefField] ?? '') : '';
        if (mid) { try { const t = String((await api<Rec>(`/tenant/p/paymentMethod/${mid}`)).data.data.type); method = ({ cod: 'cod', card: 'card', transfer: 'transfer', wallet: 'wallet' } as Record<string, string>)[t] ?? 'cash'; } catch { /* method not readable: record as cash */ } }
        const paid = await api<Rec[]>(`/tenant/p/${rec.entity}?orderId=${r.id}&pageSize=100`); const already = paid.data.reduce((a, x) => a + Number(x.data.amount ?? 0), 0);
        const due = Number(r.data[rec.amountField] ?? 0) - already; if (due > 0) await api(`/tenant/p/${rec.entity}`, { method: 'POST', body: { orderId: r.id, amount: due, method } });
      } else await api(`/tenant/p/${cfg.entity}/${r.id}`, { method: 'PATCH', body: { [cfg.payable.field]: cfg.payable.to } }); setMsg({ ok: true, text: `${r.code ?? ''} → ${enumLabel(cfg.payable.to, locale)}` }); res.reload(); }
    catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); } finally { setBusy(null); }
  };
  const shipOf = (id: string) => ship[id] ?? { carrier: '', tracking: '' };
  return (
    <>
      <div className="row between"><h1 style={{ fontSize: '1.6rem', margin: 0 }}>{cfg.title[locale]}</h1>
        <div className="row"><span className="muted small">{cfg.today ? today : ''}</span><button className="btn sm" onClick={res.reload}>{locale === 'ar' ? 'تحديث' : 'Refresh'}</button><Link className="btn sm" href={`/app/e/${cfg.entity}`}>{locale === 'ar' ? 'كل السجلات' : 'All records'}</Link></div></div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      <div className="grid" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(240px, 1fr))`, alignItems: 'start' }}>
        {cfg.columns.map((col) => {
          const items = rows.filter((r) => r.data[cfg.statusField ?? 'status'] === col.status && (!col.only || r.data[col.only.field] === col.only.value));
          return (
            <section key={col.status} className="card stack" aria-label={enumLabel(col.status, locale)}>
              <div className="row between"><b>{enumLabel(col.status, locale)}</b><span className="badge info">{items.length}</span></div>
              {col.hint && <p className="muted small">{col.hint[locale]}</p>}
              {items.length === 0 && <p className="muted small">{locale === 'ar' ? 'لا شيء هنا.' : 'Nothing here.'}</p>}
              {items.map((r) => (
                <article key={r.id} className="card stack" style={{ padding: 12, gap: 6 }}>
                  <div className="row between"><Link href={`/app/e/${cfg.entity}/${r.id}`}><b className="mono">{r.code ?? r.id.slice(0, 8)}</b></Link>{cfg.timeField && <span className="mono">{String(r.data[cfg.timeField] ?? '')}</span>}</div>
                  {cfg.refs.map(([f, e]) => <div key={f} className="small">{fieldLabel(f, locale)}: {app.refTitle(e, r.data[f])}</div>)}
                  {(cfg.extra ?? []).filter((f) => r.data[f] !== undefined && r.data[f] !== null).map((f) => <div key={f} className="small muted">{fieldLabel(f, locale)}: {typeof r.data[f] === 'number' && ['total', 'cod', 'value'].includes(f) ? app.money(r.data[f]) : String(r.data[f])}</div>)}
                  {canUpdate && cfg.shipping && cfg.shipping.from === col.status && <div className="stack" style={{ gap: 6 }}>
                    <input aria-label={fieldLabel('carrier', locale)} placeholder={fieldLabel('carrier', locale)} value={shipOf(r.id).carrier} onChange={(e) => setShip((m) => ({ ...m, [r.id]: { ...shipOf(r.id), carrier: e.target.value } }))} />
                    <input className="ltr" aria-label={fieldLabel('trackingNumber', locale)} placeholder={fieldLabel('trackingNumber', locale)} value={shipOf(r.id).tracking} onChange={(e) => setShip((m) => ({ ...m, [r.id]: { ...shipOf(r.id), tracking: e.target.value } }))} />
                    <button className="btn sm primary" disabled={busy === r.id} onClick={() => move(r, cfg.shipping!.to, { ...(shipOf(r.id).carrier.trim() ? { carrier: shipOf(r.id).carrier.trim() } : {}), ...(shipOf(r.id).tracking.trim() ? { trackingNumber: shipOf(r.id).tracking.trim() } : {}) })}>{enumLabel(cfg.shipping.to, locale)}</button></div>}
                  {canUpdate && cfg.payable && r.data[cfg.payable.field] === cfg.payable.from && !['cancelled', 'returned'].includes(String(r.data.status)) && <button className="btn sm" disabled={busy === r.id} onClick={() => markPaid(r)}>{locale === 'ar' ? 'تسجيل الدفع' : 'Record payment'}</button>}
                  {canUpdate && col.next.length > 0 && <div className="row">{col.next.map((s) => <button key={s} className={`btn sm${['cancelled', 'no_show', 'returned', 'failed_attempt'].includes(s) ? ' danger' : ' primary'}`} disabled={busy === r.id} onClick={() => move(r, s)}>{enumLabel(s, locale)}</button>)}</div>}
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}
