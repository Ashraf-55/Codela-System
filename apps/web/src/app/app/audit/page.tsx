'use client';
import { api } from '@/lib/api';
import { ErrorBox, Loading, useAsync } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';

export default function Audit() {
  const { t, locale } = useI18n(); const res = useAsync(() => api<any[]>('/tenant/audit-logs?pageSize=100'), []);
  if (res.error) return <ErrorBox error={res.error} retry={res.reload} />; if (!res.data) return <Loading />;
  return <><h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('audit')}</h1><div className="table-wrap"><table><thead><tr><th>{t('date')}</th><th>{t('actions')}</th><th>{t('type')}</th></tr></thead><tbody>{res.data.data.map((l) => (
    <tr key={l.id}><td className="mono">{new Date(l.createdAt).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')}</td><td>{l.action}</td><td className="mono small">{l.entity ?? ''} {l.entityId?.slice(0, 8) ?? ''}</td></tr>))}</tbody></table></div></>;
}
