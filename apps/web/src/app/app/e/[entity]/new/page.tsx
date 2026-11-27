'use client';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { EntityForm } from '@/components/app/EntityForm';
import { useApp } from '@/components/app/AppShell';
import { toast, useI18n } from '@/components/Providers';
import { Icon } from '@/components/Icon';

export default function NewRecord() {
  const { entity } = useParams<{ entity: string }>(); const router = useRouter(); const app = useApp(); const { t, locale } = useI18n(); const sp = useSearchParams(); const def = app.entity(entity);
  if (!def) return <div className="alert error">404</div>;
  if (!def.canCreate) return <div className="alert error">403</div>;
  const prefill = Object.fromEntries([...sp.entries()].filter(([k]) => k in def.fields));
  return <><div className="page-head"><div><nav aria-label={locale === 'ar' ? 'مسار التنقل' : 'Breadcrumb'} className="small row" style={{ gap: 4 }}><Link href={`/app/e/${entity}`}>{app.label(def)}</Link><Icon name={locale === 'ar' ? 'chevronLeft' : 'chevronRight'} size={14} /><span className="muted" aria-current="page">{t('create')}</span></nav>
    <h1 style={{ marginTop: 4 }}>{t('create')} · {app.label(def)}</h1></div><div className="actions"><Link className="btn" href={`/app/e/${entity}`}>{t('back')}</Link></div></div>
    <div className="card"><EntityForm def={def} prefill={prefill} onSaved={(r) => { toast(locale === 'ar' ? 'تم الحفظ' : 'Saved'); router.push(`/app/e/${entity}/${r.id}`); }} /></div></>;
}
