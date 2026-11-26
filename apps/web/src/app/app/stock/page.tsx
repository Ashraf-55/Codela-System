'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { ErrorBox, Loading, useApp, useAsync } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';

interface Data { warehouses: { id: string; name: string }[]; rows: { productId: string; name: string; sku: string; reorderLevel: number | null; byWarehouse: Record<string, number>; total: number }[] }

/** Business: stock per warehouse. Balances come from the movement ledger (receipts, issues, transfers, adjustments), so they always match the product total. */
export default function Stock() {
  const app = useApp(); const { locale } = useI18n(); const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const res = useAsync(() => api<Data>('/tenant/stock-balances'), []); const [q, setQ] = useState(''); const [wh, setWh] = useState(''); const [low, setLow] = useState(false);
  if (res.error) return <ErrorBox error={res.error} retry={res.reload} />; if (!res.data) return <Loading />;
  const { warehouses, rows } = res.data.data; const cols = wh ? warehouses.filter((w) => w.id === wh) : warehouses;
  const shown = rows.filter((r) => (!q.trim() || `${r.name} ${r.sku}`.toLowerCase().includes(q.trim().toLowerCase())) && (!wh || (r.byWarehouse[wh] ?? 0) !== 0) && (!low || (r.reorderLevel !== null && r.total <= r.reorderLevel)));
  return (
    <>
      <div className="row between"><h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('المخزون حسب المخزن', 'Stock by warehouse')}</h1>
        <div className="row">{app.can('stock.create') && <Link className="btn" href="/app/e/stockMovement/new">{t('حركة مخزون', 'Stock movement')}</Link>}{app.can('transfers.create') && <Link className="btn primary" href="/app/e/transfer/new">{t('تحويل بين المخازن', 'Transfer')}</Link>}</div></div>
      <div className="row" style={{ flexWrap: 'wrap' }}><input type="search" aria-label={t('بحث', 'Search')} placeholder={t('بحث بالاسم أو الكود', 'Search name or SKU')} value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
        <select aria-label={t('المخزن', 'Warehouse')} value={wh} onChange={(e) => setWh(e.target.value)} style={{ width: 'auto' }}><option value="">{t('كل المخازن', 'All warehouses')}</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        <label className="row"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} />{t('المنخفض فقط', 'Low stock only')}</label></div>
      {!rows.length ? <div className="card" style={{ textAlign: 'center' }}><p className="muted">{t('لا توجد حركات مخزون بعد. سجّل أول استلام.', 'No stock movements yet. Record the first receipt.')}</p></div> : !shown.length ? <p className="muted">{t('لا توجد نتائج.', 'No results.')}</p> :
        <div className="table-wrap"><table><thead><tr><th scope="col">{t('المنتج', 'Product')}</th>{cols.map((w) => <th key={w.id} scope="col">{w.name}</th>)}<th scope="col">{t('الإجمالي', 'Total')}</th></tr></thead>
          <tbody>{shown.map((r) => { const isLow = r.reorderLevel !== null && r.total <= r.reorderLevel; return <tr key={r.productId}><th scope="row">{r.name}<div className="mono small muted">{r.sku}</div></th>{cols.map((w) => <td key={w.id} className="mono">{r.byWarehouse[w.id] ?? 0}</td>)}<td><b className="mono">{r.total}</b> {isLow && <span className="badge bad">{t('منخفض', 'Low')}</span>}</td></tr>; })}</tbody></table></div>}
    </>
  );
}
