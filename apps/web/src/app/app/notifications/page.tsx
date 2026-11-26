'use client';
import { api } from '@/lib/api';
import { ErrorBox, Loading, useAsync } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';

export default function Notifications() {
  const { t, locale } = useI18n(); const res = useAsync(() => api<any[]>('/tenant/notifications'), []);
  if (res.error) return <ErrorBox error={res.error} retry={res.reload} />; if (!res.data) return <Loading />;
  return <><h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('notifications')}</h1>
    {!res.data.data.length ? <div className="card muted">{t('empty')}</div> : res.data.data.map((n) => (
      <div key={n.id} className="card flat row between" style={n.readAt ? { opacity: .65 } : undefined}><div><b>{n.title}</b><div className="muted small">{n.body}</div><div className="muted small mono">{new Date(n.createdAt).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')}</div></div>
        {!n.readAt && <button className="btn sm" onClick={async () => { await api(`/tenant/notifications/${n.id}/read`, { method: 'POST', body: {} }); res.reload(); }} aria-label={t('markRead')} title={t('markRead')}>✓</button>}</div>))}</>;
}
