'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api } from '@/lib/api';
import { enumLabel, fmtMoney } from '@/lib/i18n';
import { useI18n } from '@/components/Providers';

interface Ship { id: string; code: string; status: string; recipientName: string; recipientPhone: string; recipientAddress: string; recipientCity: string; description: string; notes: string; codAmount: number; attempts: number; failureReason: string; deliveredAt: string | null; hasProof: boolean; collectedAmount: number | null }
interface Me { id: string; name: string; active: number; delivered: number; cashPending: number }
interface Auth { permissions: string[]; tenant: { currency: string } }

interface Queued { id: string; code: string; status: string; extra: Record<string, unknown>; at: string }
const QUEUE_KEY = 'codela.driver.queue';
const readQueue = (): Queued[] => { try { const v = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x) => x && typeof x.id === 'string' && typeof x.status === 'string') : []; } catch { return []; } };
const writeQueue = (q: Queued[]) => { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(0, 100))); } catch { /* storage full or blocked: the update simply is not kept */ } };
/** The request never got an answer (offline, DNS, timeout, gateway down) — as opposed to the server refusing it, which must NOT be retried. */
const isNetworkError = (e: unknown) => !(e instanceof ApiError) || e.status === 0 || e.status === 502 || e.status === 503 || e.status === 504;

/** Mobile-first driver portal: my shipments, status updates, proof of delivery (recipient + photo) and cash collection. */
export default function DriverPortal() {
  const { locale } = useI18n(); const router = useRouter(); const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const [cur, setCur] = useState('EGP'); const [ready, setReady] = useState(false); const [me, setMe] = useState<Me | null>(null); const [tab, setTab] = useState<'active' | 'history'>('active'); const [rows, setRows] = useState<Ship[] | null>(null);
  const [queued, setQueued] = useState<Queued[]>([]); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(''); const [panel, setPanel] = useState<{ id: string; kind: 'deliver' | 'fail' } | null>(null);
  const money = (n: number) => fmtMoney(n, cur, locale);

  const load = useCallback(async () => {
    try { const [m, s] = await Promise.all([api<Me>('/tenant/driver/me'), api<Ship[]>(`/tenant/driver/shipments?scope=${tab}`)]); setMe(m.data); setRows(s.data); }
    catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); setRows([]); }
  }, [tab]);
  useEffect(() => { api<Auth>('/auth/me').then((a) => { if (!a.data.permissions.includes('driver.use')) { router.replace('/app'); return; } setCur(a.data.tenant.currency); setReady(true); }).catch(() => router.replace('/login')); }, [router]);
  useEffect(() => { if (ready) void load(); }, [ready, load]);

  // ---- offline tolerance: a status update that fails because of the NETWORK is kept on the phone and retried; the server's rules still decide ----
  useEffect(() => { setQueued(readQueue()); }, []);
  const flush = useCallback(async () => {
    const tt = (ar: string, en: string) => (locale === 'ar' ? ar : en); const q = readQueue(); if (!q.length || (typeof navigator !== 'undefined' && navigator.onLine === false)) return; const keep: Queued[] = []; const dropped: string[] = []; let sent = 0;
    for (let i = 0; i < q.length; i++) {
      try { await api(`/tenant/driver/shipments/${q[i].id}/status`, { method: 'POST', body: { status: q[i].status, ...q[i].extra } }); sent++; }
      catch (e) { if (isNetworkError(e)) { keep.push(...q.slice(i)); break; } dropped.push(`${q[i].code}: ${(e as ApiError).message}`); }
    }
    writeQueue(keep); setQueued(keep);
    if (sent || dropped.length) { setMsg({ ok: dropped.length === 0, text: [sent ? tt(`تم إرسال ${sent} تحديث`, `${sent} update(s) sent`) : '', ...dropped.map((d) => tt('رُفض من النظام: ', 'Rejected by the system: ') + d)].filter(Boolean).join(' — ') }); await load(); }
  }, [locale, load]);
  useEffect(() => { const on = () => void flush(); window.addEventListener('online', on); const timer = setInterval(on, 30_000); return () => { window.removeEventListener('online', on); clearInterval(timer); }; }, [flush]);
  async function where(): Promise<{ lat?: number; lng?: number }> {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return {};
    return new Promise((resolve) => navigator.geolocation.getCurrentPosition((p) => resolve({ lat: Number(p.coords.latitude.toFixed(5)), lng: Number(p.coords.longitude.toFixed(5)) }), () => resolve({}), { timeout: 4000, maximumAge: 60_000 }));
  }
  async function step(s: Ship, status: string, extra: Record<string, unknown> = {}) {
    setBusy(s.id); setMsg(null);
    const geo = await where(); const body = { status, ...extra, ...geo };
    try { await api(`/tenant/driver/shipments/${s.id}/status`, { method: 'POST', body }); setMsg({ ok: true, text: `${s.code} → ${enumLabel(status, locale)}` }); setPanel(null); await load(); }
    catch (e) {
      if (isNetworkError(e) && status !== 'delivered') { const q = [...readQueue(), { id: s.id, code: s.code, status, extra: { ...extra, ...geo }, at: new Date().toISOString() }]; writeQueue(q); setQueued(q); setPanel(null); setMsg({ ok: false, text: t('لا يوجد اتصال — حُفظ التحديث على الهاتف وسيُرسل تلقائيًا عند عودة الشبكة.', 'No connection — the update is saved on this phone and will be sent automatically when you are back online.') }); }
      else setMsg({ ok: false, text: (e as ApiError).message });
    } finally { setBusy(''); }
  }
  async function deliver(e: React.FormEvent<HTMLFormElement>, s: Ship) {
    e.preventDefault(); const f = new FormData(e.currentTarget); const photo = f.get('photo'); setBusy(s.id); setMsg(null);
    try {
      if (photo instanceof File && photo.size > 0) {
        const up = await fetch(`/api/v1/tenant/driver/shipments/${s.id}/proof`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'x-csrf-token': document.cookie.split('; ').find((c) => c.startsWith('csrf='))?.split('=')[1] ?? '' }, body: photo, credentials: 'same-origin' });
        if (!up.ok) { const j = await up.json().catch(() => ({})); throw new ApiError(up.status, j?.error?.code ?? 'ERROR', j?.error?.message ?? up.statusText); }
      }
      await step(s, 'delivered', { recipientName: String(f.get('recipient') ?? '').trim(), note: String(f.get('note') ?? '').trim() || undefined, collected: Math.round(Number(f.get('collected') ?? 0) * 100) });
    } catch (x) { setMsg({ ok: false, text: (x as ApiError).message }); setBusy(''); }
  }
  async function logout() { await api('/auth/logout', { method: 'POST' }).catch(() => {}); router.replace('/login'); }
  if (!ready) return <main style={{ padding: 24 }}><p className="muted">…</p></main>;

  return (
    <main dir={locale === 'ar' ? 'rtl' : 'ltr'} style={{ maxWidth: 560, margin: '0 auto', padding: 12 }} className="stack">
      <div className="row between"><h1 style={{ fontSize: '1.3rem' }}>{t('شحناتي', 'My deliveries')}{me ? ` — ${me.name}` : ''}</h1><button className="btn sm" onClick={logout}>{t('خروج', 'Log out')}</button></div>
      {me && <div className="grid g3"><div className="card"><span className="muted small">{t('نشطة', 'Active')}</span><br /><b>{me.active}</b></div><div className="card"><span className="muted small">{t('تم تسليمها', 'Delivered')}</span><br /><b>{me.delivered}</b></div><div className="card"><span className="muted small">{t('نقدية محصّلة', 'Cash collected')}</span><br /><b className="mono">{money(me.cashPending)}</b></div></div>}
      <div className="row" role="tablist"><button role="tab" aria-selected={tab === 'active'} className={`btn${tab === 'active' ? ' primary' : ''}`} onClick={() => setTab('active')}>{t('النشطة', 'Active')}</button><button role="tab" aria-selected={tab === 'history'} className={`btn${tab === 'history' ? ' primary' : ''}`} onClick={() => setTab('history')}>{t('السجل', 'History')}</button></div>
      {queued.length > 0 && <div className="alert warn row between" role="status"><span>{t(`${queued.length} تحديث بانتظار الإرسال`, `${queued.length} update(s) waiting to be sent`)}</span><button className="btn sm" onClick={() => void flush()}>{t('أعد المحاولة الآن', 'Retry now')}</button></div>}
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      {rows === null && <p className="muted">…</p>}
      {rows && rows.length === 0 && <div className="card"><p className="muted">{tab === 'active' ? t('لا توجد شحنات مسندة لك الآن.', 'No shipments assigned to you right now.') : t('لا يوجد سجل بعد.', 'No history yet.')}</p></div>}
      {rows?.map((s) => (
        <article key={s.id} className="card stack" aria-label={s.code}>
          <div className="row between"><b className="mono">{s.code}</b><span className="badge info">{enumLabel(s.status, locale)}</span></div>
          <div><b>{s.recipientName}</b><br /><a className="ltr" href={`tel:${s.recipientPhone}`}>{s.recipientPhone}</a></div>
          <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.recipientAddress}, ${s.recipientCity}`)}`} target="_blank" rel="noopener noreferrer">{s.recipientAddress}، {s.recipientCity}</a>
          {s.description && <span className="small muted">{s.description}</span>}{s.notes && <span className="small">{s.notes}</span>}
          {s.codAmount > 0 && <div className="alert warn">{t('حصّل نقدًا', 'Collect cash')}: <b className="mono">{money(s.codAmount)}</b></div>}
          {s.attempts > 0 && <span className="small muted">{t('محاولات فاشلة', 'Failed attempts')}: {s.attempts}{s.failureReason ? ` — ${s.failureReason}` : ''}</span>}
          {s.status === 'delivered' && <span className="small">{t('استلم', 'Received by')}: {s.recipientName}{s.hasProof ? ` · ${t('صورة الإثبات مرفوعة', 'photo proof uploaded')}` : ''}</span>}
          {tab === 'active' && panel?.id !== s.id && (
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {s.status === 'created' && <button className="btn primary" disabled={busy === s.id} onClick={() => step(s, 'picked_up')}>{t('استلمت الشحنة', 'Picked up')}</button>}
              {['picked_up', 'at_hub', 'failed_attempt'].includes(s.status) && <button className="btn primary" disabled={busy === s.id} onClick={() => step(s, 'out_for_delivery')}>{t('خرجت للتوصيل', 'Out for delivery')}</button>}
              {s.status === 'out_for_delivery' && <><button className="btn primary" onClick={() => setPanel({ id: s.id, kind: 'deliver' })}>{t('تم التسليم', 'Delivered')}</button><button className="btn" onClick={() => setPanel({ id: s.id, kind: 'fail' })}>{t('فشل التسليم', 'Failed')}</button></>}
            </div>)}
          {panel?.id === s.id && panel.kind === 'deliver' && (
            <form className="stack" onSubmit={(e) => deliver(e, s)}>
              <label className="field">{t('اسم المستلم', 'Received by')} *<input name="recipient" required minLength={2} defaultValue={s.recipientName} /></label>
              <label className="field">{t('المبلغ المحصّل', 'Cash collected')}<input name="collected" type="number" min={0} step="0.01" className="ltr" defaultValue={(s.codAmount / 100).toFixed(2)} /></label>
              <label className="field">{t('صورة إثبات التسليم', 'Proof photo')}<input name="photo" type="file" accept="image/png,image/jpeg,image/webp" capture="environment" /></label>
              <label className="field">{t('ملاحظة', 'Note')}<input name="note" maxLength={500} /></label>
              <div className="row"><button className="btn primary" disabled={busy === s.id}>{busy === s.id ? '…' : t('تأكيد التسليم', 'Confirm delivery')}</button><button type="button" className="btn" onClick={() => setPanel(null)}>{t('إلغاء', 'Cancel')}</button></div>
            </form>)}
          {panel?.id === s.id && panel.kind === 'fail' && (
            <form className="stack" onSubmit={(e) => { e.preventDefault(); void step(s, 'failed_attempt', { reason: String(new FormData(e.currentTarget).get('reason') ?? '').trim() }); }}>
              <label className="field">{t('سبب الفشل', 'Reason')} *<input name="reason" required minLength={3} maxLength={300} /></label>
              <div className="row"><button className="btn primary" disabled={busy === s.id}>{t('تسجيل المحاولة الفاشلة', 'Record failed attempt')}</button><button type="button" className="btn" onClick={() => setPanel(null)}>{t('إلغاء', 'Cancel')}</button></div>
            </form>)}
        </article>))}
    </main>
  );
}
