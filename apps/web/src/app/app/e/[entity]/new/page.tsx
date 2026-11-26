'use client';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { EntityForm } from '@/components/app/EntityForm';
import { useApp } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';

export default function NewRecord() {
  const { entity } = useParams<{ entity: string }>(); const router = useRouter(); const app = useApp(); const { t } = useI18n(); const sp = useSearchParams(); const def = app.entity(entity);
  if (!def) return <div className="alert error">404</div>;
  if (!def.canCreate) return <div className="alert error">403</div>;
  const prefill = Object.fromEntries([...sp.entries()].filter(([k]) => k in def.fields));
  return <><div className="row between"><h1 style={{ fontSize: '1.6rem', margin: 0 }}>{t('create')} · {app.label(def)}</h1><Link className="btn" href={`/app/e/${entity}`}>{t('back')}</Link></div>
    <div className="card"><EntityForm def={def} prefill={prefill} onSaved={(r) => router.push(`/app/e/${entity}/${r.id}`)} /></div></>;
}
