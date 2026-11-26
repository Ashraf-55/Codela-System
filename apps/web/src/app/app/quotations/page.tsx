'use client';
import { useMemo, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { ErrorBox, Loading, useApp, useAsync } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';

interface Rec { id: string; code: string | null; data: Record<string, any>; createdAt?: string }
interface QLine { description: string; qty: string; unitPrice: string }
const STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired'] as const;
const NEXT: Record<string, string[]> = { draft: ['sent', 'rejected'], sent: ['accepted', 'rejected', 'expired'] };
const blank = () => ({ id: '', customerId: '', dealId: '', title: '', validUntil: '', notes: '', discount: '0', taxPct: '0', lines: [{ description: '', qty: '1', unitPrice: '' }] as QLine[] });
const minor = (v: string) => Math.round(Number(v || 0) * 100);

/** Business: quotations — create / edit drafts, track the status flow (draft → sent → accepted / rejected / expired), see the pipeline value and conversion, print. The server enforces every rule (locked once sent, transitions, totals). */
export default function Quotations() {
  const app = useApp(); const { locale } = useI18n(); const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const qs = useAsync(() => api<Rec[]>('/tenant/p/quotation?pageSize=100&sort=createdAt&dir=desc').then((r) => r.data), []);
  const customers = useAsync(() => api<Rec[]>('/tenant/p/customer?pageSize=100').then((r) => r.data).catch(() => [] as Rec[]), []);
  const deals = useAsync(() => api<Rec[]>('/tenant/p/deal?pageSize=100').then((r) => r.data).catch(() => [] as Rec[]), []);
  const [f, setF] = useState<ReturnType<typeof blank> | null>(null); const [view, setView] = useState(''); const [status, setStatus] = useState(''); const [q, setQ] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(false);
  const cname = useMemo(() => new Map((customers.data ?? []).map((c) => [c.id, String(c.data.name)])), [customers.data]);
  if (!app.can('quotations.read')) return <div className="alert warn" role="alert">{t('لا تملك صلاحية عروض الأسعار.', 'You cannot view quotations.')}</div>;
  if (qs.error) return <ErrorBox error={qs.error} retry={qs.reload} />; if (!qs.data) return <Loading />;
  const m = app.money; const all = qs.data; const num = (r: Rec, k: string) => Number(r.data[k] ?? 0);
  const count = (s: string) => all.filter((r) => r.data.status === s).length; const sum = (s: string[]) => all.filter((r) => s.includes(String(r.data.status))).reduce((a, r) => a + num(r, 'total'), 0);
  const decided = count('accepted') + count('rejected') + count('expired'); const rate = decided ? Math.round((count('accepted') / decided) * 100) : null;
  const shown = all.filter((r) => (!status || r.data.status === status) && (!q.trim() || `${r.code} ${r.data.title} ${cname.get(String(r.data.customerId)) ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())));
  const chosen = all.find((r) => r.id === view);
  const sub = f ? f.lines.reduce((a, l) => a + Number(l.qty || 0) * minor(l.unitPrice), 0) : 0; const disc = f ? minor(f.discount) : 0; const tax = f ? Math.round(((sub - disc) * Number(f.taxPct || 0)) / 100) : 0;
  const fail = (e: unknown) => { const a = e as ApiError; setMsg({ ok: false, text: a.fields ? `${a.message}: ${Object.entries(a.fields).map(([k, v]) => `${k} ${v}`).join(', ')}` : a.message }); };
  async function save() {
    if (!f) return; setBusy(true); setMsg(null);
    const body = { customerId: f.customerId, dealId: f.dealId || undefined, title: f.title.trim(), validUntil: f.validUntil || undefined, notes: f.notes || undefined, discount: disc, taxBp: Math.round(Number(f.taxPct || 0) * 100),
      lines: f.lines.map((l) => ({ description: l.description.trim(), qty: Number(l.qty), unitPrice: minor(l.unitPrice) })) };
    try { if (f.id) await api(`/tenant/p/quotation/${f.id}`, { method: 'PATCH', body }); else await api('/tenant/p/quotation', { method: 'POST', body }); setMsg({ ok: true, text: t('تم حفظ عرض السعر.', 'Quotation saved.') }); setF(null); qs.reload(); } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function move(r: Rec, to: string) { setBusy(true); setMsg(null); try { await api(`/tenant/p/quotation/${r.id}`, { method: 'PATCH', body: { status: to } }); setMsg({ ok: true, text: t('تم تحديث الحالة.', 'Status updated.') }); qs.reload(); } catch (e) { fail(e); } finally { setBusy(false); } }
  const edit = (r: Rec) => setF({ id: r.id, customerId: String(r.data.customerId), dealId: String(r.data.dealId ?? ''), title: String(r.data.title), validUntil: String(r.data.validUntil ?? '').slice(0, 10), notes: String(r.data.notes ?? ''), discount: String(num(r, 'discount') / 100), taxPct: String(num(r, 'taxBp') / 100),
    lines: (r.data.lines as { description: string; qty: number; unitPrice: number }[]).map((l) => ({ description: l.description, qty: String(l.qty), unitPrice: String(l.unitPrice / 100) })) });
  const setLine = (i: number, k: keyof QLine, v: string) => setF((x) => x && ({ ...x, lines: x.lines.map((l, n) => (n === i ? { ...l, [k]: v } : l)) }));
  const label = (s: string) => ({ draft: t('مسودة', 'Draft'), sent: t('مُرسل', 'Sent'), accepted: t('مقبول', 'Accepted'), rejected: t('مرفوض', 'Rejected'), expired: t('منتهي', 'Expired') } as Record<string, string>)[s] ?? s;
  const act = (s: string) => ({ sent: t('إرسال', 'Send'), accepted: t('قبول', 'Accept'), rejected: t('رفض', 'Reject'), expired: t('تعليم كمنتهي', 'Mark expired') } as Record<string, string>)[s] ?? s;

  return (
    <>
      <div className="row between no-print"><h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('عروض الأسعار', 'Quotations')}</h1>{app.can('quotations.create') && !f && <button className="btn primary" onClick={() => { setView(''); setF(blank()); }}>+ {t('عرض سعر جديد', 'New quotation')}</button>}</div>
      {msg && <div className={`alert no-print ${msg.ok ? 'ok' : 'error'}`} role="alert">{msg.text}</div>}
      <section className="grid g4 no-print" aria-label={t('إحصائيات', 'Statistics')}>
        <div className="card kpi"><span className="muted small">{t('مفتوحة (مسودة + مُرسلة)', 'Open (draft + sent)')}</span><b data-testid="kpi-open">{count('draft') + count('sent')}</b><span className="small">{m(sum(['draft', 'sent']))}</span></div>
        <div className="card kpi"><span className="muted small">{t('مقبولة', 'Accepted')}</span><b>{count('accepted')}</b><span className="small">{m(sum(['accepted']))}</span></div>
        <div className="card kpi"><span className="muted small">{t('مرفوضة / منتهية', 'Rejected / expired')}</span><b>{count('rejected') + count('expired')}</b><span className="small">{m(sum(['rejected', 'expired']))}</span></div>
        <div className="card kpi"><span className="muted small">{t('نسبة القبول', 'Win rate')}</span><b data-testid="kpi-rate">{rate === null ? '—' : `${rate}%`}</b><span className="small muted">{t('من العروض المحسومة', 'of decided quotations')}</span></div>
      </section>

      {f && <section className="card stack no-print" aria-label={f.id ? t('تعديل عرض سعر', 'Edit quotation') : t('عرض سعر جديد', 'New quotation')}>
        <h2 style={{ margin: 0 }}>{f.id ? t('تعديل عرض السعر', 'Edit quotation') : t('عرض سعر جديد', 'New quotation')}</h2>
        <div className="grid g3">
          <label className="field">{t('العميل', 'Customer')}<select value={f.customerId} onChange={(e) => setF({ ...f, customerId: e.target.value, dealId: '' })}><option value="">—</option>{(customers.data ?? []).map((c) => <option key={c.id} value={c.id}>{String(c.data.name)}</option>)}</select></label>
          <label className="field">{t('الصفقة (اختياري)', 'Deal (optional)')}<select value={f.dealId} onChange={(e) => setF({ ...f, dealId: e.target.value })}><option value="">—</option>{(deals.data ?? []).filter((d) => d.data.customerId === f.customerId).map((d) => <option key={d.id} value={d.id}>{String(d.data.title ?? d.code)}</option>)}</select></label>
          <label className="field">{t('عنوان العرض', 'Title')}<input maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
          <label className="field">{t('صالح حتى', 'Valid until')}<input type="date" value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} /></label>
          <label className="field">{t('الخصم', 'Discount')}<input type="number" min={0} step="0.01" value={f.discount} onChange={(e) => setF({ ...f, discount: e.target.value })} /></label>
          <label className="field">{t('ضريبة %', 'Tax %')}<input type="number" min={0} max={100} step="0.01" value={f.taxPct} onChange={(e) => setF({ ...f, taxPct: e.target.value })} /></label>
        </div>
        <div className="table-wrap"><table><caption className="sr-only">{t('بنود العرض', 'Quotation lines')}</caption><thead><tr><th scope="col">{t('البند', 'Description')}</th><th scope="col">{t('الكمية', 'Qty')}</th><th scope="col">{t('سعر الوحدة', 'Unit price')}</th><th scope="col">{t('الإجمالي', 'Total')}</th><th scope="col"><span className="sr-only">{t('حذف', 'Remove')}</span></th></tr></thead>
          <tbody>{f.lines.map((l, i) => <tr key={i}>
            <td><input aria-label={`${t('البند', 'Description')} ${i + 1}`} maxLength={300} value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} /></td>
            <td><input aria-label={`${t('الكمية', 'Qty')} ${i + 1}`} type="number" min={1} step={1} value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} style={{ width: 80 }} /></td>
            <td><input aria-label={`${t('سعر الوحدة', 'Unit price')} ${i + 1}`} type="number" min={0} step="0.01" value={l.unitPrice} onChange={(e) => setLine(i, 'unitPrice', e.target.value)} style={{ width: 120 }} /></td>
            <td>{m(Number(l.qty || 0) * minor(l.unitPrice))}</td>
            <td><button className="btn sm danger" disabled={f.lines.length === 1} onClick={() => setF({ ...f, lines: f.lines.filter((_, n) => n !== i) })} aria-label={`${t('حذف البند', 'Remove line')} ${i + 1}`}>×</button></td></tr>)}</tbody></table></div>
        <div><button className="btn sm" onClick={() => setF({ ...f, lines: [...f.lines, { description: '', qty: '1', unitPrice: '' }] })} disabled={f.lines.length >= 200}>+ {t('بند', 'Add line')}</button></div>
        <label className="field">{t('ملاحظات', 'Notes')}<textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        <p data-testid="form-totals" className="row" style={{ gap: 18 }}><span>{t('المجموع', 'Subtotal')}: <b>{m(sub)}</b></span><span>{t('الخصم', 'Discount')}: <b>{m(disc)}</b></span><span>{t('الضريبة', 'Tax')}: <b>{m(tax)}</b></span><span>{t('الإجمالي', 'Total')}: <b>{m(sub - disc + tax)}</b></span></p>
        <div className="row"><button className="btn primary" disabled={busy || !f.customerId || !f.title.trim() || f.lines.some((l) => !l.description.trim() || !l.unitPrice)} onClick={() => void save()}>{t('حفظ', 'Save')}</button><button className="btn" onClick={() => setF(null)}>{t('إلغاء', 'Cancel')}</button></div>
      </section>}

      {!f && <section className="card stack no-print">
        <div className="row"><label className="field" style={{ flex: 1 }}>{t('بحث', 'Search')}<input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('الرقم أو العنوان أو العميل', 'Code, title or customer')} /></label>
          <div className="row" role="group" aria-label={t('تصفية بالحالة', 'Filter by status')}>{['', ...STATUSES].map((s) => <button key={s || 'all'} className={`btn sm${status === s ? ' primary' : ''}`} aria-pressed={status === s} onClick={() => setStatus(s)}>{s ? `${label(s)} (${count(s)})` : `${t('الكل', 'All')} (${all.length})`}</button>)}</div></div>
        {!shown.length ? <p className="muted">{t('لا توجد عروض مطابقة.', 'No matching quotations.')}</p> : <div className="table-wrap"><table><caption className="sr-only">{t('عروض الأسعار', 'Quotations')}</caption><thead><tr><th scope="col">{t('الرقم', 'Code')}</th><th scope="col">{t('العنوان', 'Title')}</th><th scope="col">{t('العميل', 'Customer')}</th><th scope="col">{t('صالح حتى', 'Valid until')}</th><th scope="col">{t('الإجمالي', 'Total')}</th><th scope="col">{t('الحالة', 'Status')}</th><th scope="col"><span className="sr-only">{t('إجراءات', 'Actions')}</span></th></tr></thead>
          <tbody>{shown.map((r) => <tr key={r.id} data-testid="quotation-row"><td className="mono">{r.code}</td><td>{String(r.data.title)}</td><td>{cname.get(String(r.data.customerId)) ?? '—'}</td><td>{r.data.validUntil ? String(r.data.validUntil).slice(0, 10) : '—'}</td><td>{m(num(r, 'total'))}</td><td><span className={`badge ${r.data.status === 'accepted' ? 'ok' : r.data.status === 'rejected' || r.data.status === 'expired' ? 'bad' : r.data.status === 'sent' ? 'info' : ''}`}>{label(String(r.data.status))}</span></td>
            <td className="row"><button className="btn sm" onClick={() => setView(r.id)}>{t('عرض', 'View')}</button>{r.data.status === 'draft' && app.can('quotations.update') && <button className="btn sm" onClick={() => edit(r)}>{t('تعديل', 'Edit')}</button>}
              {app.can('quotations.update') && (NEXT[String(r.data.status)] ?? []).map((s) => <button key={s} className="btn sm" disabled={busy} onClick={() => void move(r, s)}>{act(s)}</button>)}</td></tr>)}</tbody></table></div>}
      </section>}

      {chosen && !f && <section className="card stack print-area" aria-label={t('تفاصيل عرض السعر', 'Quotation details')}>
        <div className="row between"><div><h2 style={{ margin: 0 }}>{app.me.tenant.name}</h2><span className="muted small">{t('عرض سعر', 'Quotation')} {chosen.code} — {label(String(chosen.data.status))}</span></div><span className="no-print row"><button className="btn sm" onClick={() => window.print()}>{t('طباعة', 'Print')}</button><button className="btn sm" onClick={() => setView('')}>{t('إغلاق', 'Close')}</button></span></div>
        <p><b>{String(chosen.data.title)}</b><br />{t('العميل', 'Customer')}: {cname.get(String(chosen.data.customerId)) ?? '—'}{chosen.data.validUntil ? <> · {t('صالح حتى', 'Valid until')} {String(chosen.data.validUntil).slice(0, 10)}</> : null}</p>
        <div className="table-wrap"><table><thead><tr><th scope="col">{t('البند', 'Description')}</th><th scope="col">{t('الكمية', 'Qty')}</th><th scope="col">{t('سعر الوحدة', 'Unit price')}</th><th scope="col">{t('الإجمالي', 'Total')}</th></tr></thead>
          <tbody>{(chosen.data.lines as { description: string; qty: number; unitPrice: number }[]).map((l, i) => <tr key={i}><td>{l.description}</td><td>{l.qty}</td><td>{m(l.unitPrice)}</td><td>{m(l.qty * l.unitPrice)}</td></tr>)}</tbody></table></div>
        <p className="row" style={{ gap: 18 }}><span>{t('المجموع', 'Subtotal')}: <b>{m(num(chosen, 'subtotal'))}</b></span><span>{t('الخصم', 'Discount')}: <b>{m(num(chosen, 'discount'))}</b></span><span>{t('الضريبة', 'Tax')}: <b>{m(num(chosen, 'tax'))}</b></span><span>{t('الإجمالي', 'Total')}: <b>{m(num(chosen, 'total'))}</b></span></p>
        {chosen.data.notes ? <p style={{ whiteSpace: 'pre-wrap' }}>{String(chosen.data.notes)}</p> : null}
      </section>}
    </>
  );
}
