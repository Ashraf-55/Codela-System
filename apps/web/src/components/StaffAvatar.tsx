'use client';
import { useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';

const csrf = () => (typeof document === 'undefined' ? '' : document.cookie.split('; ').find((c) => c.startsWith('csrf='))?.split('=')[1] ?? '');
/** Own profile picture for owners / staff (validated by bytes on the server, private, only you can fetch it). */
export function StaffAvatar({ locale }: { locale: 'ar' | 'en' }) {
  const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const [has, setHas] = useState<boolean | null>(null); const [v, setV] = useState(0); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { fetch('/api/v1/auth/me/avatar', { credentials: 'same-origin', cache: 'no-store' }).then((r) => setHas(r.ok)).catch(() => setHas(false)); }, [v]);
  async function upload(file: File) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/v1/auth/me/avatar', { method: 'PUT', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name), 'x-csrf-token': csrf() }, body: file });
      const j = await res.json().catch(() => ({})); if (!res.ok) throw new ApiError(res.status, j?.error?.code ?? 'ERROR', j?.error?.message ?? res.statusText);
      setV(Date.now()); setMsg({ ok: true, text: t('تم تحديث الصورة.', 'Picture updated.') });
    } catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); } finally { setBusy(false); }
  }
  return (
    <section className="card stack" aria-labelledby="avatar"><h3 id="avatar">{t('الصورة الشخصية', 'Profile picture')}</h3>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      <div className="row" style={{ alignItems: 'center', gap: 16 }}>
        {has ? <img src={`/api/v1/auth/me/avatar?v=${v}`} alt={t('صورتي', 'My picture')} width={72} height={72} style={{ borderRadius: '50%', objectFit: 'cover' }} /> : <span aria-hidden="true" style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--surface-2)', display: 'inline-block' }} />}
        <label className="btn sm">{t('تغيير الصورة', 'Change picture')}<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} /></label>
        {has && <button className="btn sm" disabled={busy} onClick={() => { setBusy(true); api('/auth/me/avatar', { method: 'DELETE' }).then(() => { setHas(false); setV(Date.now()); }).catch((e) => setMsg({ ok: false, text: (e as ApiError).message })).finally(() => setBusy(false)); }}>{t('إزالة', 'Remove')}</button>}
      </div>
    </section>
  );
}
