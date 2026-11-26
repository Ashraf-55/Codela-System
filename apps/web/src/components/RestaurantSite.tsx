'use client';
import { useMemo, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { fmtMoney, type Locale } from '@/lib/i18n';

interface Extra { name: string; price: number }
export interface MCat { id: string; name: string; sortOrder?: number }
export interface MItem { id: string; name: string; categoryId: string; description?: string; price: number; image?: string; extras?: Extra[]; prepTimeMin?: number }
interface Line { key: string; item: MItem; qty: number; extras: string[] }
const L = (locale: Locale) => (ar: string, en: string) => (locale === 'ar' ? ar : en);
const safeImg = (u?: string) => (u && (/^https:\/\//.test(u) || /^\/api\/v1\/public\/files\/[0-9a-f-]{36}$/.test(u)) ? u : undefined);
const unitOf = (l: Line) => l.item.price + l.extras.reduce((a, n) => a + (l.item.extras?.find((e) => e.name === n)?.price ?? 0), 0);

/** Public digital menu with extras, a cart and online ordering (takeaway / delivery). The server prices the order again from the real menu. */
export function RestaurantMenu({ cats, items, locale, currency, site }: { cats: MCat[]; items: MItem[]; locale: Locale; currency: string; site?: string }) {
  const t = L(locale); const [cat, setCat] = useState(''); const [open, setOpen] = useState(''); const [pickExtras, setPickExtras] = useState<string[]>([]); const [cart, setCart] = useState<Line[]>([]);
  const [type, setType] = useState<'takeaway' | 'delivery'>('takeaway'); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState<{ orderCode: string; total: number } | null>(null);
  const ordered = useMemo(() => [...cats].sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0)), [cats]);
  const shown = ordered.filter((c) => !cat || c.id === cat);
  const total = cart.reduce((a, l) => a + unitOf(l) * l.qty, 0);
  function add(item: MItem, extras: string[]) {
    const key = `${item.id}|${[...extras].sort().join(',')}`;
    setCart((c) => (c.some((l) => l.key === key) ? c.map((l) => (l.key === key ? { ...l, qty: Math.min(99, l.qty + 1) } : l)) : [...c, { key, item, qty: 1, extras }])); setOpen(''); setPickExtras([]);
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); setErr('');
    try {
      const r = await api<{ orderCode: string; total: number }>('/public/actions/order', { method: 'POST', site, body: { type, customer: { name: f.get('name'), phone: f.get('phone') }, address: type === 'delivery' ? f.get('address') : undefined, lines: cart.map((l) => ({ itemId: l.item.id, qty: l.qty, extras: l.extras.join(', ') })) } });
      setDone(r.data); setCart([]);
    } catch (x) { setErr((x as ApiError).message); } finally { setBusy(false); }
  }
  return (
    <section id="menu" className="block"><div className="container stack"><h2>{t('المنيو', 'Menu')}</h2>
      <div className="row" style={{ flexWrap: 'wrap' }} role="group" aria-label={t('أقسام المنيو', 'Menu categories')}><button className={`btn sm${!cat ? ' primary' : ''}`} onClick={() => setCat('')}>{t('الكل', 'All')}</button>{ordered.map((c) => <button key={c.id} className={`btn sm${cat === c.id ? ' primary' : ''}`} aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{c.name}</button>)}</div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'start' }}>
        <div className="stack" style={{ gridColumn: 'span 2' }}>
          {!items.length && <p className="muted">{t('المنيو قيد التحديث.', 'The menu is being updated.')}</p>}
          {shown.map((c) => { const list = items.filter((i) => i.categoryId === c.id); if (!list.length) return null; return (
            <div key={c.id} className="stack"><h3>{c.name}</h3><div className="grid g2">{list.map((i) => { const img = safeImg(i.image); const exs = i.extras ?? []; return (
              <article key={i.id} className="card cat-card stack" style={{ textAlign: 'start' }}>
                <div className="row" style={{ alignItems: 'flex-start' }}>{img && <img src={img} alt={i.name} loading="lazy" width={84} height={84} style={{ objectFit: 'cover', borderRadius: 12 }} />}<div className="grow"><b>{i.name}</b>{i.description && <p className="small muted" style={{ margin: '4px 0' }}>{i.description}</p>}<b className="mono">{fmtMoney(i.price, currency, locale)}</b></div></div>
                {open === i.id && exs.length > 0 && <div className="stack">{exs.map((x) => <label key={x.name} className="row small"><input type="checkbox" checked={pickExtras.includes(x.name)} onChange={(ev) => setPickExtras((p) => (ev.target.checked ? [...p, x.name] : p.filter((n) => n !== x.name)))} /> {x.name} <span className="muted">+{fmtMoney(x.price, currency, locale)}</span></label>)}</div>}
                <div className="row">{open === i.id ? <><button className="btn sm primary" onClick={() => add(i, pickExtras)}>{t('أضف للسلة', 'Add to cart')}</button><button className="btn sm" onClick={() => setOpen('')}>{t('إلغاء', 'Cancel')}</button></> : <button className="btn sm primary" onClick={() => (exs.length ? (setOpen(i.id), setPickExtras([])) : add(i, []))}>{exs.length ? t('اختر الإضافات', 'Customise') : t('أضف للسلة', 'Add to cart')}</button>}</div>
              </article>); })}</div></div>); })}
        </div>
        <aside className="card stack" aria-label={t('سلة الطلب', 'Your order')} style={{ position: 'sticky', top: 88 }}><h3>{t('طلبك', 'Your order')}</h3>
          {done && <div className="alert ok stack" role="status"><b>{t('تم استلام طلبك ✔', 'Order received ✔')}</b><span>{t('رقم الطلب', 'Order code')}: <b className="mono">{done.orderCode}</b></span><span>{t('الإجمالي (شامل الضريبة)', 'Total (incl. tax)')}: <b>{fmtMoney(done.total, currency, locale)}</b></span><span className="small">{t('تابع طلبك برقمك وهاتفك من قسم التتبع.', 'Track it with the code and your phone number.')}</span></div>}
          {!cart.length ? <p className="muted small">{t('السلة فارغة.', 'Your cart is empty.')}</p> : <>
            {cart.map((l) => <div key={l.key} className="stack" style={{ gap: 2 }}><div className="row between"><b>{l.item.name}</b><span className="mono small">{fmtMoney(unitOf(l) * l.qty, currency, locale)}</span></div>{!!l.extras.length && <span className="small muted">+ {l.extras.join(', ')}</span>}
              <div className="row"><button className="btn sm" aria-label="−" onClick={() => setCart((c) => c.flatMap((x) => (x.key !== l.key ? [x] : x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : [])))}>−</button><b className="mono">{l.qty}</b><button className="btn sm" aria-label="+" onClick={() => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, qty: Math.min(99, x.qty + 1) } : x)))}>+</button></div></div>)}
            <div className="row between"><span>{t('المجموع قبل الضريبة', 'Subtotal')}</span><b className="mono">{fmtMoney(total, currency, locale)}</b></div>
            <form className="stack" onSubmit={submit}>
              <div className="row" role="group" aria-label={t('نوع الطلب', 'Order type')}><button type="button" className={`btn sm${type === 'takeaway' ? ' primary' : ''}`} aria-pressed={type === 'takeaway'} onClick={() => setType('takeaway')}>{t('استلام من الفرع', 'Pickup')}</button><button type="button" className={`btn sm${type === 'delivery' ? ' primary' : ''}`} aria-pressed={type === 'delivery'} onClick={() => setType('delivery')}>{t('توصيل', 'Delivery')}</button></div>
              <label className="field">{t('الاسم', 'Name')} *<input name="name" required minLength={2} autoComplete="name" /></label><label className="field">{t('الهاتف', 'Phone')} *<input name="phone" required type="tel" className="ltr" autoComplete="tel" /></label>
              {type === 'delivery' && <label className="field">{t('العنوان', 'Address')} *<input name="address" required minLength={3} autoComplete="street-address" /></label>}
              <p className="small muted">{t('الدفع عند الاستلام. الضريبة تُضاف تلقائيًا.', 'Pay on receipt. Tax is added automatically.')}</p>
              <button className="btn primary" disabled={busy}>{busy ? '…' : t('تأكيد الطلب', 'Place order')}</button></form></>}
          {err && <div className="alert error" role="alert">{err}</div>}
        </aside>
      </div></div></section>
  );
}
