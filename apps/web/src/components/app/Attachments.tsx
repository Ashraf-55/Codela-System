'use client';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { useApp, useAsync } from './AppShell';
import { useI18n } from '../Providers';

interface FileRow { id: string; name: string; mime: string; size: number; url: string; createdAt: string }
const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Files attached to one record. Access mirrors the record's own permissions on the server (read to list/download, update to add/remove). */
export function Attachments({ entity, id }: { entity: string; id: string }) {
  const app = useApp(); const { locale } = useI18n(); const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const res = useAsync(() => api<FileRow[]>(`/tenant/files?entityId=${encodeURIComponent(id)}`), [id]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(false);
  const purpose = entity === 'medicalRecord' || entity === 'patient' ? 'medical' : app.me.tenant.productSlug === 'learning' ? 'education' : 'document';
  const csrf = typeof document === 'undefined' ? '' : (document.cookie.split('; ').find((c) => c.startsWith('csrf='))?.split('=')[1] ?? '');
  async function upload(f: File) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/v1/tenant/files?purpose=${purpose}&entityType=${encodeURIComponent(entity)}&entityId=${encodeURIComponent(id)}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(f.name), ...(csrf ? { 'x-csrf-token': csrf } : {}) }, body: f });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new ApiError(r.status, j?.error?.code ?? 'ERROR', j?.error?.message ?? r.statusText);
      setMsg({ ok: true, text: t('تم رفع الملف.', 'File uploaded.') }); res.reload();
    } catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); } finally { setBusy(false); }
  }
  async function remove(fid: string) {
    setMsg(null); try { await api(`/tenant/files/${fid}`, { method: 'DELETE' }); res.reload(); } catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); }
  }
  if (res.error?.status === 403) return null; // no permission to see this record's files
  return (
    <section className="card stack" aria-labelledby="att"><div className="row between"><h3 id="att">{t('المرفقات', 'Attachments')}</h3>
      <label className="btn sm">{busy ? t('جارٍ الرفع…', 'Uploading…') : t('رفع ملف', 'Upload file')}
        <input type="file" hidden disabled={busy} accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.docx,.xlsx,.pptx,.txt,.csv" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} /></label></div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      {res.loading && !res.data && <div role="status" aria-busy="true">{t('جارٍ التحميل…', 'Loading…')}</div>}
      {res.data && res.data.data.length === 0 && <p className="muted small">{t('لا توجد مرفقات.', 'No attachments.')}</p>}
      {res.data?.data.map((f) => <div key={f.id} className="row between"><a href={f.url} target="_blank" rel="noopener noreferrer">{f.name}</a><span className="row"><span className="muted small">{fmtSize(f.size)}</span><button className="btn sm danger" onClick={() => remove(f.id)} aria-label={t('حذف', 'Delete')}>✕</button></span></div>)}
    </section>
  );
}
