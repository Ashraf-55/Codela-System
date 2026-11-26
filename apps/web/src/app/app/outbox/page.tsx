'use client';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { enumLabel } from '@/lib/i18n';
import { ErrorBox, Loading, useAsync } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';

export default function Outbox() {
  const { locale } = useI18n(); const res = useAsync(() => api<any[]>('/tenant/outbox'), []); const [msg, setMsg] = useState('');
  async function retry(id: string) { setMsg(''); try { await api(`/tenant/outbox/${id}/retry`, { method: 'POST', body: {} }); res.reload(); } catch (e) { setMsg((e as ApiError).message); } }
  if (res.error) return <ErrorBox error={res.error} retry={res.reload} />; if (!res.data) return <Loading />;
  return (
    <><h1 style={{ fontSize: '1.6rem', margin: 0 }}>{locale === 'ar' ? 'الرسائل الصادرة' : 'Outbound messages'}</h1>
      <div className="alert">{locale === 'ar' ? 'حالة "لا يوجد مزوّد" تعني أنه لم يُربط مزوّد SMS/WhatsApp/بريد فعلي؛ لا نعرض أي رسالة كمُرسلة ما لم يتم إرسالها فعلًا.' : '"no_provider" means no real SMS/WhatsApp/email provider is connected; nothing is shown as sent unless it was really delivered.'}</div>
      {msg && <div className="alert error" role="alert">{msg}</div>}
      {!res.data.data.length ? <div className="card muted">—</div> : <div className="table-wrap"><table><thead><tr><th>Channel</th><th>To</th><th>Template</th><th>Status</th><th>#</th><th /></tr></thead><tbody>{res.data.data.map((m) => (
        <tr key={m.id}><td>{m.channel}</td><td className="mono">{m.toAddr}</td><td>{m.template}</td><td><span className={`badge ${m.status === 'sent' ? 'ok' : m.status === 'failed' ? 'bad' : 'warn'}`}>{enumLabel(m.status, locale)}</span></td><td>{m.attempts}</td>
          <td>{(m.status === 'failed' || m.status === 'no_provider') && m.attempts < 3 && <button className="btn sm" onClick={() => retry(m.id)}>↻</button>}</td></tr>))}</tbody></table></div>}</>
  );
}
