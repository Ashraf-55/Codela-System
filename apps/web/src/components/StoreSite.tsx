'use client';
import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { fmtMoney, type Locale } from '@/lib/i18n';

interface Img { url: string; caption?: string }
export interface SCat { id: string; name: string; parentId?: string }
export interface SProduct { id: string; name: string; categoryId?: string; description?: string; basePrice: number; compareAtPrice?: number; images?: Img[] }
export interface SVariant { id: string; productId: string; sku: string; attributes?: { name: string; value: string }[]; price?: number; stock?: number }
export interface SShip { id: string; name: string; fee: number; freeOver?: number; etaDays?: number }
export interface SPay { id: string; name: string; type: string }
export interface SPolicy { id: string; title: string; body: string }
// a cart line remembers what the shopper saw (name/price/stock); the SERVER quote is still the only source of totals
interface CartLine { variantId: string; qty: number; name: string; price: number; stock: number }
const PAGE_SIZE = 12;
interface Quote { items: { variantId: string; name: string; unitPrice: number; qty: number; lineTotal: number }[]; subtotal: number; discount: number; shippingFee: number; tax: number; total: number; couponCode: string | null }

const safeImg = (u?: string) => (u && (/^https:\/\//.test(u) || /^\/api\/v1\/public\/files\/[0-9a-f-]{36}$/.test(u)) ? u : undefined);
const MAX_QTY = 99;
const variantLabel = (v: SVariant) => ((v.attributes ?? []).map((a) => a.value).join(' / ') || v.sku);

/**
 * Public online store: server-side search / category / price / sort / pagination (the browser never loads the whole catalogue),
 * product page whose variants are fetched on demand, images, a persistent cart,
 * server-side quote (prices, coupon, shipping, tax are always computed by the API) and checkout.
 * Payment is whatever methods the merchant configured; only "cash on delivery" is settled without the merchant's follow-up.
 */
export function Storefront({ cats, initial, ships, pays, policies = [], locale, currency, site }: { cats: SCat[]; initial: { rows: SProduct[]; total: number }; ships: SShip[]; pays: SPay[]; policies?: SPolicy[]; locale: Locale; currency: string; site?: string }) {
  const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const money = (n: number) => fmtMoney(n, currency, locale);
  const storeKey = `codela-cart:${site ?? 'host'}`;

  const [cat, setCat] = useState(''); const [q, setQ] = useState(''); const [maxPrice, setMaxPrice] = useState(''); const [sort, setSort] = useState<'new' | 'low' | 'high'>('new');
  const [openId, setOpenId] = useState(''); const [pickVariant, setPickVariant] = useState(''); const [qty, setQty] = useState(1); const [mainImg, setMainImg] = useState(0);
  const [cart, setCart] = useState<CartLine[]>([]); const [loaded, setLoaded] = useState(false); const [showCart, setShowCart] = useState(false);
  const [shipId, setShipId] = useState(''); const [payId, setPayId] = useState(''); const [couponInput, setCouponInput] = useState(''); const [applied, setApplied] = useState(''); const [couponMsg, setCouponMsg] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState<{ orderCode: string; total: number; payName: string; payType: string } | null>(null);

  const [products, setProducts] = useState<SProduct[]>(initial.rows); const [total, setTotal] = useState(initial.total); const [page, setPage] = useState(1); const [listing, setListing] = useState(false); const [listErr, setListErr] = useState('');
  const [openVariants, setOpenVariants] = useState<SVariant[]>([]); const [varLoading, setVarLoading] = useState(false); const [varErr, setVarErr] = useState('');
  const [openProd, setOpenProd] = useState<SProduct | null>(null);
  const firstRun = useRef(true); const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const unit = (v: SVariant, p: SProduct | null) => v.price ?? p?.basePrice ?? 0;

  // every filter change is a request to the API (debounced for typing); nothing is filtered in the browser
  useEffect(() => { setPage(1); }, [cat, q, maxPrice, sort]);
  useEffect(() => {
    if (firstRun.current && page === 1 && !cat && !q && !maxPrice && sort === 'new') { firstRun.current = false; return; }
    firstRun.current = false; let current = true;
    const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (q.trim()) qs.set('q', q.trim()); if (cat) qs.set('categoryId', cat);
    const cap = maxPrice ? Math.round(Number(maxPrice) * 100) : NaN; if (Number.isFinite(cap) && cap >= 0) qs.set('basePrice_to', String(cap));
    if (sort !== 'new') { qs.set('sort', 'basePrice'); qs.set('dir', sort === 'low' ? 'asc' : 'desc'); }
    setListing(true); setListErr('');
    const timer = setTimeout(() => {
      api<SProduct[]>(`/public/catalog/product?${qs}`, { site }).then((r) => { if (!current) return; setProducts(r.data); setTotal(r.meta?.total ?? r.data.length); })
        .catch((x) => { if (current) setListErr((x as ApiError).message); }).finally(() => { if (current) setListing(false); });
    }, q ? 300 : 0);
    return () => { current = false; clearTimeout(timer); };
  }, [page, cat, q, maxPrice, sort, site]);

  // the cart survives page reloads (per store, in this browser only); lines of variants that no longer exist are dropped
  useEffect(() => {
    try { const raw = JSON.parse(localStorage.getItem(storeKey) ?? '[]'); if (Array.isArray(raw)) setCart(raw.filter((l) => l && typeof l.variantId === 'string' && Number.isInteger(l.qty) && l.qty > 0).map((l) => ({ variantId: String(l.variantId), qty: Math.min(MAX_QTY, Number(l.qty)), name: String(l.name ?? ''), price: Number(l.price) || 0, stock: Number(l.stock) || MAX_QTY }))); } catch { /* storage unavailable or corrupt: start empty */ }
    setLoaded(true);
  }, [storeKey]);
  useEffect(() => { if (!loaded) return; try { localStorage.setItem(storeKey, JSON.stringify(cart)); } catch { /* ignore */ } }, [cart, loaded, storeKey]);
  const live = cart;
  const count = live.reduce((a, l) => a + l.qty, 0);

  // the server prices the cart: totals shown here are never computed from client prices
  useEffect(() => {
    if (!live.length) { setQuote(null); return; }
    let current = true;
    api<Quote>('/public/actions/quote', { method: 'POST', site, body: { lines: live.map((l) => ({ variantId: l.variantId, qty: l.qty })), couponCode: applied || undefined, shippingMethodId: shipId || undefined } })
      .then((r) => { if (current) { setQuote(r.data); setErr(''); } })
      .catch((x) => { if (!current) return; const e = x as ApiError; if (e.code === 'COUPON_INVALID') { setApplied(''); setCouponMsg(e.message); } else setErr(e.message); });
    return () => { current = false; };
  }, [live, applied, shipId, site]);

  useEffect(() => {
    if (!openId && !showCart) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpenId(''); setOpenProd(null); setShowCart(false); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [openId, showCart]);

  const open = openProd; const chosen = openVariants.find((v) => v.id === pickVariant);
  async function openProduct(p: SProduct) {
    setOpenProd(p); setOpenId(p.id); setPickVariant(''); setQty(1); setMainImg(0); setOpenVariants([]); setVarErr(''); setVarLoading(true);
    try { const r = await api<SVariant[]>(`/public/catalog/variant?productId=${encodeURIComponent(p.id)}&pageSize=50`, { site }); setOpenVariants(r.data); setPickVariant((r.data.find((v) => (v.stock ?? 0) > 0) ?? r.data[0])?.id ?? ''); }
    catch (x) { setVarErr((x as ApiError).message); } finally { setVarLoading(false); }
  }
  function addToCart(v: SVariant, n: number) {
    const stock = v.stock ?? 0; if (stock <= 0 || !open) return; const label = (v.attributes?.length ?? 0) > 0 ? ` (${variantLabel(v)})` : '';
    setCart((c) => { const have = c.find((l) => l.variantId === v.id)?.qty ?? 0; const next = Math.min(MAX_QTY, stock, have + n); const line: CartLine = { variantId: v.id, qty: next, name: open.name + label, price: unit(v, open), stock };
      return have ? c.map((l) => (l.variantId === v.id ? line : l)) : [...c, line]; });
    setOpenId(''); setOpenProd(null); setShowCart(true); setDone(null);
  }
  const setLineQty = (id: string, n: number) => setCart((c) => c.flatMap((l) => (l.variantId !== id ? [l] : n <= 0 ? [] : [{ ...l, qty: Math.min(MAX_QTY, l.stock, n) }])));
  const applyCoupon = () => { setCouponMsg(''); setApplied(couponInput.trim().toUpperCase()); };
  const pay = pays.find((p) => p.id === payId);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget); const val = (k: string) => String(f.get(k) ?? '').trim(); setBusy(true); setErr('');
    const name = val('name'); const phone = val('phone'); const email = val('email');
    try {
      const r = await api<{ orderCode: string; total: number }>('/public/actions/checkout', { method: 'POST', site, body: {
        customer: { name, phone, ...(email ? { email } : {}) }, address: { name, phone, address: val('address'), city: val('city') },
        lines: live.map((l) => ({ variantId: l.variantId, qty: l.qty })), shippingMethodId: shipId || undefined, paymentMethodId: payId || undefined, couponCode: applied || undefined } });
      setDone({ orderCode: r.data.orderCode, total: r.data.total, payName: pay?.name ?? '', payType: pay?.type ?? 'cod' }); setCart([]); setQuote(null); setApplied(''); setCouponInput('');
    } catch (x) { setErr((x as ApiError).message); } finally { setBusy(false); }
  }

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 60, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 12 };
  return (
    <section id="store" className="block"><div className="container stack">
      <div className="row between" style={{ flexWrap: 'wrap' }}><h2>{t('المتجر', 'Shop')}</h2>
        <button className="btn primary" onClick={() => setShowCart(true)} aria-label={t('فتح السلة', 'Open cart')}>{t('السلة', 'Cart')} ({count})</button></div>
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
        <label className="field grow">{t('بحث', 'Search')}<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ابحث عن منتج…', 'Search products…')} /></label>
        <label className="field">{t('أقصى سعر', 'Max price')}<input type="number" min={0} className="ltr" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} style={{ width: 120 }} /></label>
        <label className="field">{t('الترتيب', 'Sort')}<select value={sort} onChange={(e) => setSort(e.target.value as 'new' | 'low' | 'high')}><option value="new">{t('الأحدث', 'Newest')}</option><option value="low">{t('الأقل سعرًا', 'Price: low to high')}</option><option value="high">{t('الأعلى سعرًا', 'Price: high to low')}</option></select></label>
      </div>
      {cats.length > 0 && <div className="row" style={{ flexWrap: 'wrap' }} role="group" aria-label={t('التصنيفات', 'Categories')}><button className={`btn sm${!cat ? ' primary' : ''}`} aria-pressed={!cat} onClick={() => setCat('')}>{t('الكل', 'All')}</button>{cats.map((c) => <button key={c.id} className={`btn sm${cat === c.id ? ' primary' : ''}`} aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{c.name}</button>)}</div>}
      {listErr && <div className="alert error" role="alert">{listErr}</div>}
      {listing && <p className="muted" role="status">{t('جارٍ التحميل…', 'Loading…')}</p>}
      {!listing && !listErr && !products.length && <p className="muted">{total === 0 && !q && !cat && !maxPrice ? t('المتجر قيد التجهيز، سنضيف المنتجات قريبًا.', 'The store is being set up — products are coming soon.') : t('لا توجد منتجات مطابقة.', 'No matching products.')}</p>}
      <div className="grid g3">{products.map((p) => { const img = safeImg(p.images?.[0]?.url); return (
        <article key={p.id} className="card cat-card stack" style={{ textAlign: 'start' }}>
          <button onClick={() => openProduct(p)} style={{ all: 'unset', cursor: 'pointer', display: 'block' }} aria-label={p.name}>
            {img ? <img src={img} alt={p.images?.[0]?.caption || p.name} loading="lazy" width={400} height={300} style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 12 }} /> : <div aria-hidden="true" style={{ width: '100%', aspectRatio: '4 / 3', borderRadius: 12, background: 'var(--surface-2)', display: 'grid', placeItems: 'center', fontSize: '2rem' }}>{p.name.slice(0, 1)}</div>}
          </button>
          <div className="row between"><b>{p.name}</b></div>
          <span><b className="mono">{money(p.basePrice)}</b>{p.compareAtPrice && p.compareAtPrice > p.basePrice ? <><s className="muted small" style={{ marginInlineStart: 8 }}>{money(p.compareAtPrice)}</s> <span className="badge bad">-{Math.round((1 - p.basePrice / p.compareAtPrice) * 100)}%</span></> : null}</span>
          <button className="btn sm" onClick={() => openProduct(p)}>{t('التفاصيل', 'Details')}</button>
        </article>); })}</div>
      {total > PAGE_SIZE && <nav className="row between" aria-label={t('الصفحات', 'Pages')}><button className="btn sm" disabled={page <= 1 || listing} onClick={() => setPage((n) => n - 1)}>{t('السابق', 'Previous')}</button><span className="small muted" aria-live="polite">{t(`صفحة ${page} من ${pages}`, `Page ${page} of ${pages}`)} · {total} {t('منتج', 'products')}</span><button className="btn sm" disabled={page >= pages || listing} onClick={() => setPage((n) => n + 1)}>{t('التالي', 'Next')}</button></nav>}

      {open && (
        <div style={overlay} onClick={() => { setOpenId(''); setOpenProd(null); }}>
          <div className="card stack" role="dialog" aria-modal="true" aria-label={open.name} onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', maxWidth: 760, width: '100%', maxHeight: '92vh', overflow: 'auto', textAlign: 'start' }}>
            <div className="row between"><h3>{open.name}</h3><button className="btn sm" onClick={() => { setOpenId(''); setOpenProd(null); }} aria-label={t('إغلاق', 'Close')}>✕</button></div>
            <div className="grid g2" style={{ alignItems: 'start' }}>
              <div className="stack">
                {safeImg(open.images?.[mainImg]?.url) ? <img src={safeImg(open.images?.[mainImg]?.url)} alt={open.images?.[mainImg]?.caption || open.name} style={{ width: '100%', borderRadius: 12, aspectRatio: '4 / 3', objectFit: 'cover' }} /> : <div aria-hidden="true" style={{ aspectRatio: '4 / 3', borderRadius: 12, background: 'var(--surface-2)' }} />}
                {(open.images?.length ?? 0) > 1 && <div className="row" style={{ flexWrap: 'wrap' }}>{open.images!.map((im, i) => { const s = safeImg(im.url); return s ? <button key={i} onClick={() => setMainImg(i)} aria-label={`${t('صورة', 'Image')} ${i + 1}`} aria-pressed={mainImg === i} style={{ all: 'unset', cursor: 'pointer', outline: mainImg === i ? '2px solid var(--color-primary)' : 'none', borderRadius: 8 }}><img src={s} alt="" width={64} height={64} style={{ objectFit: 'cover', borderRadius: 8 }} /></button> : null; })}</div>}
              </div>
              <div className="stack">
                {open.description && <p>{open.description}</p>}
                {varLoading ? <p className="muted" role="status">{t('جارٍ التحميل…', 'Loading…')}</p> : varErr ? <div className="alert error" role="alert">{varErr}</div> : openVariants.length === 0 ? <div className="alert warn">{t('هذا المنتج غير متاح للطلب حاليًا.', 'This product is not available to order right now.')}</div> : <>
                  <div className="stack" role="group" aria-label={t('الأنواع', 'Options')}><b>{t('اختر النوع', 'Choose an option')}</b><div className="row" style={{ flexWrap: 'wrap' }}>{openVariants.map((v) => <button key={v.id} className={`btn sm${pickVariant === v.id ? ' primary' : ''}`} aria-pressed={pickVariant === v.id} disabled={(v.stock ?? 0) <= 0} onClick={() => { setPickVariant(v.id); setQty(1); }}>{variantLabel(v)}</button>)}</div></div>
                  {chosen && <>
                    <b className="mono" style={{ fontSize: '1.3rem' }}>{money(unit(chosen, open))}</b>
                    <span className={`badge ${(chosen.stock ?? 0) > 0 ? ((chosen.stock ?? 0) <= 5 ? 'warn' : 'ok') : 'bad'}`}>{(chosen.stock ?? 0) > 0 ? ((chosen.stock ?? 0) <= 5 ? t(`متبقي ${chosen.stock} فقط`, `Only ${chosen.stock} left`) : t('متوفر', 'In stock')) : t('نفد من المخزون', 'Out of stock')}</span>
                    {(chosen.stock ?? 0) > 0 && <div className="row"><button className="btn sm" aria-label="−" onClick={() => setQty((n) => Math.max(1, n - 1))}>−</button><b className="mono">{qty}</b><button className="btn sm" aria-label="+" onClick={() => setQty((n) => Math.min(MAX_QTY, chosen.stock ?? 1, n + 1))}>+</button></div>}
                    <button className="btn primary" disabled={(chosen.stock ?? 0) <= 0} onClick={() => addToCart(chosen, qty)}>{t('أضف للسلة', 'Add to cart')}</button>
                  </>}
                </>}
              </div>
            </div>
          </div>
        </div>
      )}

      {showCart && (
        <div style={{ ...overlay, justifyContent: 'flex-end', alignItems: 'stretch', padding: 0 }} onClick={() => setShowCart(false)}>
          <aside className="stack" role="dialog" aria-modal="true" aria-label={t('سلة المشتريات', 'Shopping cart')} onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', width: 'min(440px, 100%)', height: '100%', overflow: 'auto', padding: 16, textAlign: 'start' }}>
            <div className="row between"><h3>{t('سلة المشتريات', 'Your cart')}</h3><button className="btn sm" onClick={() => setShowCart(false)} aria-label={t('إغلاق', 'Close')}>✕</button></div>
            {done && <div className="alert ok stack" role="status"><b>{t('تم استلام طلبك ✔', 'Order received ✔')}</b><span>{t('رقم الطلب', 'Order code')}: <b className="mono">{done.orderCode}</b></span><span>{t('الإجمالي', 'Total')}: <b>{money(done.total)}</b></span>
              <span className="small">{done.payType === 'cod' ? t('الدفع عند الاستلام.', 'Pay on delivery.') : t(`سيتواصل معك المتجر لإتمام الدفع (${done.payName}).`, `The store will contact you to complete payment (${done.payName}).`)} {t('تابع طلبك برقمه وهاتفك من قسم التتبع.', 'Track it with the code and your phone from the tracking section.')}</span></div>}
            {!live.length && !done && <p className="muted">{t('السلة فارغة.', 'Your cart is empty.')}</p>}
            {live.map((l) => { const priced = quote?.items.find((x) => x.variantId === l.variantId); return (
              <div key={l.variantId} className="stack" style={{ gap: 4 }}><div className="row between"><b>{priced?.name ?? l.name}</b><span className="mono small">{money(priced?.lineTotal ?? l.price * l.qty)}</span></div>
                <div className="row"><button className="btn sm" aria-label="−" onClick={() => setLineQty(l.variantId, l.qty - 1)}>−</button><b className="mono">{l.qty}</b><button className="btn sm" aria-label="+" onClick={() => setLineQty(l.variantId, l.qty + 1)}>+</button><button className="btn sm" onClick={() => setLineQty(l.variantId, 0)}>{t('إزالة', 'Remove')}</button></div></div>); })}
            {!!live.length && <>
              <div className="row"><label className="field grow">{t('كوبون خصم', 'Coupon code')}<input className="ltr" value={couponInput} onChange={(e) => setCouponInput(e.target.value)} /></label><button className="btn sm" style={{ alignSelf: 'end' }} onClick={applyCoupon} disabled={!couponInput.trim()}>{t('تطبيق', 'Apply')}</button></div>
              {couponMsg && <div className="alert error" role="alert">{couponMsg}</div>}
              {ships.length > 0 && <label className="field">{t('طريقة الشحن', 'Shipping method')}<select value={shipId} onChange={(e) => setShipId(e.target.value)}><option value="">{t('اختر…', 'Choose…')}</option>{ships.map((s) => <option key={s.id} value={s.id}>{s.name} — {money(s.fee)}{s.etaDays ? ` · ${s.etaDays} ${t('يوم', 'days')}` : ''}{s.freeOver ? ` · ${t('مجاني فوق', 'free over')} ${money(s.freeOver)}` : ''}</option>)}</select></label>}
              {quote && <div className="stack" style={{ gap: 4 }}>
                <div className="row between"><span>{t('المجموع', 'Subtotal')}</span><b className="mono">{money(quote.subtotal)}</b></div>
                {quote.discount > 0 && <div className="row between"><span>{t('الخصم', 'Discount')}{quote.couponCode ? ` (${quote.couponCode})` : ''}</span><b className="mono">−{money(quote.discount)}</b></div>}
                <div className="row between"><span>{t('الشحن', 'Shipping')}</span><b className="mono">{shipId ? money(quote.shippingFee) : '—'}</b></div>
                {quote.tax > 0 && <div className="row between"><span>{t('الضريبة', 'Tax')}</span><b className="mono">{money(quote.tax)}</b></div>}
                <div className="row between" style={{ fontSize: '1.1rem' }}><b>{t('الإجمالي', 'Total')}</b><b className="mono">{money(quote.total)}</b></div></div>}
              <form className="stack" onSubmit={submit}>
                <h4>{t('بيانات التوصيل', 'Delivery details')}</h4>
                <label className="field">{t('الاسم', 'Name')} *<input name="name" required minLength={2} autoComplete="name" /></label>
                <label className="field">{t('الهاتف', 'Phone')} *<input name="phone" required type="tel" className="ltr" autoComplete="tel" /></label>
                <label className="field">{t('البريد الإلكتروني (لربط الطلب بحسابك)', 'E-mail (to see the order in your account)')}<input name="email" type="email" className="ltr" autoComplete="email" /></label>
                <label className="field">{t('المدينة', 'City')} *<input name="city" required minLength={2} autoComplete="address-level2" /></label>
                <label className="field">{t('العنوان', 'Address')} *<input name="address" required minLength={3} autoComplete="street-address" /></label>
                {pays.length > 0 && <label className="field">{t('طريقة الدفع', 'Payment method')} *<select value={payId} required onChange={(e) => setPayId(e.target.value)}><option value="">{t('اختر…', 'Choose…')}</option>{pays.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
                {pay && pay.type !== 'cod' && <p className="small muted">{t('هذه الطريقة لا تتم أونلاين من الموقع: سيتواصل معك المتجر لتأكيد الدفع بعد استلام الطلب.', 'This method is not charged on the site: the store will contact you to confirm payment after you place the order.')}</p>}
                {err && <div className="alert error" role="alert">{err}</div>}
                <button className="btn primary" disabled={busy || !quote || (ships.length > 0 && !shipId)}>{busy ? '…' : t('تأكيد الطلب', 'Place order')}</button>
              </form></>}
            {!live.length && err && <div className="alert error" role="alert">{err}</div>}
          </aside>
        </div>
      )}
      {!!policies.length && <div className="stack" id="policies"><h3>{t('سياسات المتجر', 'Store policies')}</h3>{policies.map((p) => <details key={p.id} className="card"><summary><b>{p.title}</b></summary><p style={{ whiteSpace: 'pre-wrap' }}>{p.body}</p></details>)}</div>}
    </div></section>
  );
}
