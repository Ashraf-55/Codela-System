'use client';
import { useEffect, useMemo, useState } from 'react';
import { toMinor } from '@codela/shared';
import { ApiError, api } from '@/lib/api';
import { fmtMoney } from '@/lib/i18n';
import { printSlip } from '@/lib/print';
import { ErrorBox, Loading, useApp, useAsync, type Rec } from '@/components/app/AppShell';

interface Extra { name: string; price: number }
interface Line { key: string; itemId: string; name: string; unit: number; qty: number; extras: string[]; extraPrice: number; note: string }
type OType = 'dine_in' | 'takeaway' | 'delivery';
async function all(entity: string): Promise<Rec[]> { const out: Rec[] = []; for (let p = 1; p <= 10; p++) { const r = await api<Rec[]>(`/tenant/p/${entity}?page=${p}&pageSize=100`); out.push(...r.data); if (out.length >= (r.meta?.total ?? 0)) break; } return out; }

/** Cashier point-of-sale: pick items (with extras), choose dine-in / takeaway / delivery, send to the kitchen, take payment. Prices, tax and totals are always computed by the server. */
export default function Pos() {
  const app = useApp(); const { locale, currency } = app; const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const menu = useAsync(async () => ({ cats: await all('menuCategory'), items: await all('menuItem'), tables: await all('restaurantTable') }), []);
  const unpaid = useAsync(() => api<Rec[]>('/tenant/p/order?paymentStatus=unpaid&pageSize=50'), []);
  const [cat, setCat] = useState(''); const [q, setQ] = useState(''); const [cart, setCart] = useState<Line[]>([]); const [pick, setPick] = useState<Rec | null>(null); const [chosen, setChosen] = useState<string[]>([]);
  const [type, setType] = useState<OType>('takeaway'); const [tableId, setTableId] = useState(''); const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [address, setAddress] = useState(''); const [discount, setDiscount] = useState('');
  const [split, setSplit] = useState<{ o: Rec; parts: { amount: string; method: 'cash' | 'card' | 'online' }[] } | null>(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [placed, setPlaced] = useState<Rec | null>(null);
  useEffect(() => { const i = setInterval(() => unpaid.reload(), 20000); return () => clearInterval(i); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const items = useMemo(() => (menu.data?.items ?? []).filter((i) => i.data.available !== false && (!cat || i.data.categoryId === cat) && (!q || String(i.data.name).toLowerCase().includes(q.toLowerCase()))), [menu.data, cat, q]);
  if (!app.entity('order')?.canCreate) return <div className="alert error">403</div>;
  if (menu.error) return <ErrorBox error={menu.error} retry={menu.reload} />; if (!menu.data) return <Loading />;
  const tables = menu.data.tables.filter((x) => x.data.status !== 'out_of_service');
  const subtotal = cart.reduce((a, l) => a + (l.unit + l.extraPrice) * l.qty, 0); const disc = Math.min(subtotal, discount ? toMinor(discount, currency) : 0);

  function add(it: Rec, extras: string[]) {
    const defs = (it.data.extras as Extra[] | undefined) ?? []; const extraPrice = extras.reduce((a, n) => a + (defs.find((d) => d.name === n)?.price ?? 0), 0); const key = `${it.id}|${[...extras].sort().join(',')}`;
    setCart((c) => (c.some((l) => l.key === key) ? c.map((l) => (l.key === key ? { ...l, qty: Math.min(99, l.qty + 1) } : l)) : [...c, { key, itemId: it.id, name: String(it.data.name), unit: Number(it.data.price), qty: 1, extras, extraPrice, note: '' }]));
    setPick(null); setChosen([]);
  }
  const click = (it: Rec) => { const ex = (it.data.extras as Extra[] | undefined) ?? []; if (ex.length) { setPick(it); setChosen([]); } else add(it, []); };
  async function send() {
    setMsg(null); setBusy(true);
    try {
      const body: Record<string, unknown> = { type, channel: 'pos', lines: cart.map((l) => ({ itemId: l.itemId, qty: l.qty, ...(l.extras.length ? { extras: l.extras.join(', ') } : {}), ...(l.note ? { note: l.note } : {}) })) };
      if (type === 'dine_in') body.tableId = tableId; if (name) body.customerName = name; if (phone) body.customerPhone = phone; if (type === 'delivery') body.address = address; if (disc > 0) body.discount = disc;
      const r = await api<Rec>('/tenant/p/order', { method: 'POST', body }); setPlaced(r.data); setCart([]); setDiscount(''); setName(''); setPhone(''); setAddress(''); setTableId(''); unpaid.reload(); menu.reload();
    } catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); } finally { setBusy(false); }
  }
  async function pay(o: Rec, method: 'cash' | 'card') {
    setMsg(null);
    try { await api(`/tenant/p/order/${o.id}`, { method: 'PATCH', body: { paymentStatus: 'paid', paymentMethod: method } }); setMsg({ ok: true, text: `${o.code} — ${t('تم تسجيل الدفع', 'payment recorded')}` }); if (placed?.id === o.id) setPlaced(null); unpaid.reload(); }
    catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); }
  }
  const canSend = cart.length > 0 && !busy && (type !== 'dine_in' || !!tableId) && (type !== 'delivery' || (phone.trim().length >= 7 && address.trim().length >= 3));
  const typeLabel: Record<OType, string> = { dine_in: t('في المطعم', 'Dine-in'), takeaway: t('تيك أواي', 'Takeaway'), delivery: t('دليفري', 'Delivery') };

  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const lines = (o: Rec) => ((o.data.items as { name: string; qty: number; extras?: string[]; lineTotal: number }[] | undefined) ?? []);
  const kitchenTicket = (o: Rec) => printSlip(`${t('تذكرة مطبخ', 'Kitchen ticket')} ${String(o.code)}`, [{ left: `${typeLabel[o.data.type as OType]}${o.data.tableId ? ' · ' + (menu.data!.tables.find((x) => x.id === o.data.tableId)?.data.number ?? '') : ''}`, bold: true }, ...lines(o).flatMap((l) => [{ left: `${l.qty} × ${l.name}`, bold: true }, ...(l.extras?.length ? [{ left: `  + ${l.extras.join(', ')}` }] : [])])], dir);
  const receipt = (o: Rec) => printSlip(`${t('إيصال', 'Receipt')} ${String(o.code)}`, [...lines(o).map((l) => ({ left: `${l.qty} × ${l.name}`, right: fmtMoney(l.lineTotal, currency, locale) })), { left: t('الإجمالي الفرعي', 'Subtotal'), right: fmtMoney(Number(o.data.subtotal), currency, locale) }, ...(Number(o.data.discount) ? [{ left: t('خصم', 'Discount'), right: '-' + fmtMoney(Number(o.data.discount), currency, locale) }] : []), ...(Number(o.data.serviceCharge) ? [{ left: t('خدمة', 'Service'), right: fmtMoney(Number(o.data.serviceCharge), currency, locale) }] : []), ...(Number(o.data.tax) ? [{ left: t('ضريبة', 'Tax'), right: fmtMoney(Number(o.data.tax), currency, locale) }] : []), { left: t('الإجمالي', 'Total'), right: fmtMoney(Number(o.data.total), currency, locale), bold: true }], dir);
  const openSplit = (o: Rec, n = 2) => { const total = Number(o.data.total); const base = Math.floor(total / n); setSplit({ o, parts: Array.from({ length: n }, (_, i) => ({ amount: ((i === n - 1 ? total - base * (n - 1) : base) / 100).toFixed(2), method: 'cash' as const })) }); };
  async function paySplit() {
    if (!split) return; setMsg(null);
    try { for (const p of split.parts) await api('/tenant/p/orderPayment', { method: 'POST', body: { orderId: split.o.id, amount: toMinor(p.amount, currency), method: p.method } }); setMsg({ ok: true, text: `${split.o.code} — ${t('تم تسجيل الدفعات', 'payments recorded')}` }); if (placed?.id === split.o.id) setPlaced(null); setSplit(null); unpaid.reload(); }
    catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); unpaid.reload(); }
  }
  async function moveTable(o: Rec, tableId: string) {
    setMsg(null); try { await api(`/tenant/p/order/${o.id}`, { method: 'PATCH', body: { tableId } }); setMsg({ ok: true, text: `${o.code} — ${t('تم نقل الطاولة', 'table changed')}` }); unpaid.reload(); menu.reload(); } catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); }
  }
  return (
    <>
      <div className="row between"><h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('نقطة البيع', 'Point of sale')}</h1><button className="btn sm" onClick={() => { menu.reload(); unpaid.reload(); }}>{t('تحديث', 'Refresh')}</button></div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'start' }}>
        <section className="card stack" style={{ gridColumn: 'span 2' }} aria-label={t('المنيو', 'Menu')}>
          <div className="row" style={{ flexWrap: 'wrap' }}><input type="search" placeholder={t('ابحث عن صنف…', 'Search items…')} value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 240 }} aria-label={t('بحث', 'Search')} />
            <button className={`btn sm${!cat ? ' primary' : ''}`} onClick={() => setCat('')}>{t('الكل', 'All')}</button>{menu.data.cats.filter((c) => c.data.active !== false).sort((a, b) => Number(a.data.sortOrder ?? 0) - Number(b.data.sortOrder ?? 0)).map((c) => <button key={c.id} className={`btn sm${cat === c.id ? ' primary' : ''}`} aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{String(c.data.name)}</button>)}</div>
          {pick && <div className="card flat stack" role="dialog" aria-label={String(pick.data.name)}><b>{String(pick.data.name)} — {t('الإضافات', 'Extras')}</b>
            {(pick.data.extras as Extra[]).map((e) => <label key={e.name} className="row small"><input type="checkbox" checked={chosen.includes(e.name)} onChange={(ev) => setChosen((c) => (ev.target.checked ? [...c, e.name] : c.filter((x) => x !== e.name)))} /> {e.name} <span className="muted">+{fmtMoney(e.price, currency, locale)}</span></label>)}
            <div className="row"><button className="btn sm primary" onClick={() => add(pick, chosen)}>{t('إضافة للطلب', 'Add to order')}</button><button className="btn sm" onClick={() => setPick(null)}>{t('إلغاء', 'Cancel')}</button></div></div>}
          {!items.length ? <p className="muted">{t('لا أصناف متاحة.', 'No available items.')}</p> : <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>{items.map((i) => (
            <button key={i.id} className="card stack" style={{ textAlign: 'start', cursor: 'pointer', minHeight: 84 }} onClick={() => click(i)}><b>{String(i.data.name)}</b><span className="mono small">{fmtMoney(Number(i.data.price), currency, locale)}</span></button>))}</div>}
        </section>

        <section className="card stack" aria-label={t('الطلب الحالي', 'Current order')}><h3>{t('الطلب الحالي', 'Current order')}</h3>
          <div className="row" role="group" aria-label={t('نوع الطلب', 'Order type')}>{(['dine_in', 'takeaway', 'delivery'] as OType[]).map((x) => <button key={x} className={`btn sm${type === x ? ' primary' : ''}`} aria-pressed={type === x} onClick={() => setType(x)}>{typeLabel[x]}</button>)}</div>
          {type === 'dine_in' && <label className="field">{t('الطاولة', 'Table')}<select value={tableId} onChange={(e) => setTableId(e.target.value)}><option value="">{t('اختر…', 'Choose…')}</option>{tables.map((x) => <option key={x.id} value={x.id}>{String(x.data.number)} · {x.data.seats} · {x.data.status === 'free' ? t('فاضية', 'free') : String(x.data.status)}</option>)}</select></label>}
          {type !== 'dine_in' && <div className="grid g2"><label className="field">{t('الاسم', 'Name')}<input value={name} onChange={(e) => setName(e.target.value)} /></label><label className="field">{t('الهاتف', 'Phone')}<input className="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} /></label></div>}
          {type === 'delivery' && <label className="field">{t('العنوان', 'Address')}<input value={address} onChange={(e) => setAddress(e.target.value)} /></label>}
          {!cart.length ? <p className="muted small">{t('اختر أصنافًا من المنيو.', 'Pick items from the menu.')}</p> : cart.map((l) => (
            <div key={l.key} className="stack" style={{ gap: 4 }}><div className="row between"><b>{l.name}</b><span className="mono small">{fmtMoney((l.unit + l.extraPrice) * l.qty, currency, locale)}</span></div>
              {!!l.extras.length && <div className="small muted">+ {l.extras.join(', ')}</div>}
              <div className="row"><button className="btn sm" aria-label="−" onClick={() => setCart((c) => c.flatMap((x) => (x.key !== l.key ? [x] : x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : [])))}>−</button><b className="mono">{l.qty}</b><button className="btn sm" aria-label="+" onClick={() => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, qty: Math.min(99, x.qty + 1) } : x)))}>+</button>
                <input placeholder={t('ملاحظة', 'Note')} maxLength={120} value={l.note} onChange={(e) => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, note: e.target.value } : x)))} /><button className="btn sm danger" onClick={() => setCart((c) => c.filter((x) => x.key !== l.key))}>✕</button></div></div>))}
          <label className="field">{t('خصم', 'Discount')}<input className="ltr" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" /></label>
          <div className="row between"><span>{t('الإجمالي الفرعي', 'Subtotal')}</span><b className="mono">{fmtMoney(subtotal - disc, currency, locale)}</b></div>
          <p className="small muted">{t('الضريبة والإجمالي النهائي يحسبهما النظام عند الإرسال.', 'Tax and the final total are calculated by the system when you send.')}</p>
          <button className="btn primary" disabled={!canSend} onClick={() => void send()}>{busy ? '…' : t('إرسال للمطبخ', 'Send to kitchen')}</button>
          {placed && <div className="alert ok stack" role="status"><b>{String(placed.code)} — {fmtMoney(Number(placed.data.total), currency, locale)}</b>
            <div className="row"><button className="btn sm primary" onClick={() => void pay(placed, 'cash')}>{t('دفع نقدي', 'Pay cash')}</button><button className="btn sm" onClick={() => void pay(placed, 'card')}>{t('دفع بالبطاقة', 'Pay card')}</button><button className="btn sm" onClick={() => openSplit(placed)}>{t('تقسيم الدفع', 'Split payment')}</button><button className="btn sm" onClick={() => setPlaced(null)}>{t('دفع لاحقًا', 'Pay later')}</button></div><div className="row"><button className="btn sm" onClick={() => kitchenTicket(placed)}>{t('طباعة تذكرة المطبخ', 'Print kitchen ticket')}</button><button className="btn sm" onClick={() => receipt(placed)}>{t('طباعة الإيصال', 'Print receipt')}</button></div></div>}
        </section>

        {split && <section className="card stack" role="dialog" aria-label={t('تقسيم الدفع', 'Split payment')}><h3>{t('تقسيم الدفع', 'Split payment')} — {String(split.o.code)} · {fmtMoney(Number(split.o.data.total), currency, locale)}</h3>
          <div className="row"><span className="small">{t('عدد الأشخاص', 'People')}</span>{[2, 3, 4, 5].map((n) => <button key={n} className={`btn sm${split.parts.length === n ? ' primary' : ''}`} onClick={() => openSplit(split.o, n)}>{n}</button>)}</div>
          {split.parts.map((p, i) => <div key={i} className="row"><input className="ltr" inputMode="decimal" value={p.amount} aria-label={`${t('مبلغ', 'Amount')} ${i + 1}`} onChange={(e) => setSplit({ ...split, parts: split.parts.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) })} /><select value={p.method} onChange={(e) => setSplit({ ...split, parts: split.parts.map((x, j) => (j === i ? { ...x, method: e.target.value as 'cash' | 'card' } : x)) })}><option value="cash">{t('نقدي', 'Cash')}</option><option value="card">{t('بطاقة', 'Card')}</option></select></div>)}
          {(() => { const sum = split.parts.reduce((a, p) => a + toMinor(p.amount || '0', currency), 0); const ok = sum === Number(split.o.data.total); return <><p className={`small ${ok ? 'muted' : ''}`} role="status">{ok ? t('المجموع يطابق الإجمالي.', 'Parts match the total.') : `${t('المجموع الحالي', 'Current sum')}: ${fmtMoney(sum, currency, locale)}`}</p><div className="row"><button className="btn primary" disabled={!ok} onClick={() => void paySplit()}>{t('تسجيل الدفعات', 'Record payments')}</button><button className="btn" onClick={() => setSplit(null)}>{t('إلغاء', 'Cancel')}</button></div></>; })()}</section>}

        <section className="card stack" aria-label={t('طلبات غير مدفوعة', 'Unpaid orders')}><h3>{t('طلبات غير مدفوعة', 'Unpaid orders')}</h3>
          {!unpaid.data?.data.filter((o) => o.data.status !== 'cancelled').length ? <p className="muted small">{t('لا طلبات مفتوحة.', 'No open bills.')}</p> : unpaid.data.data.filter((o) => o.data.status !== 'cancelled').map((o) => (
            <div key={o.id} className="row between"><span><b className="mono">{o.code}</b> <span className="small muted">{typeLabel[o.data.type as OType]} · {String(o.data.status)}</span></span><span className="row"><b className="mono">{fmtMoney(Number(o.data.total), currency, locale)}</b><button className="btn sm primary" onClick={() => void pay(o, 'cash')}>{t('نقدي', 'Cash')}</button><button className="btn sm" onClick={() => void pay(o, 'card')}>{t('بطاقة', 'Card')}</button><button className="btn sm" onClick={() => openSplit(o)}>{t('تقسيم', 'Split')}</button><button className="btn sm" aria-label={t('طباعة', 'Print')} onClick={() => receipt(o)}>🖨</button></span>
              {o.data.type === 'dine_in' && ['new', 'preparing', 'ready', 'served'].includes(String(o.data.status)) && <select aria-label={t('نقل لطاولة', 'Move to table')} value="" onChange={(e) => e.target.value && void moveTable(o, e.target.value)} style={{ width: 'auto' }}><option value="">{t('نقل لطاولة…', 'Move to table…')}</option>{tables.filter((x) => x.data.status === 'free').map((x) => <option key={x.id} value={x.id}>{String(x.data.number)}</option>)}</select>}</div>))}
        </section>
      </div>
    </>
  );
}
