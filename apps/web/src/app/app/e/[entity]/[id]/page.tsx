'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { enumLabel, fieldLabel } from '@/lib/i18n';
import { Cell } from '@/components/app/Cells';
import { EntityForm } from '@/components/app/EntityForm';
import { Attachments } from '@/components/app/Attachments';
import { ErrorBox, Loading, useApp, useAsync, type Rec } from '@/components/app/AppShell';
import { useI18n } from '@/components/Providers';

export default function RecordPage() {
  const { entity, id } = useParams<{ entity: string; id: string }>(); const router = useRouter(); const app = useApp(); const { t, locale } = useI18n(); const def = app.entity(entity);
  const [editing, setEditing] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const res = useAsync(() => api<Rec>(`/tenant/p/${entity}/${id}`), [entity, id]);
  useEffect(() => { app.ensureRefs(Object.values(def?.fields ?? {}).map((f) => f.entity)); }, [def, app]);
  if (!def) return <div className="alert error">404</div>;
  if (res.error) return <ErrorBox error={res.error} retry={res.reload} />;
  if (!res.data) return <Loading />;
  const rec = res.data.data; const stateKey = ['status', 'stage'].find((k) => def.fields[k]?.type === 'enum'); const stateField = stateKey ? def.fields[stateKey] : undefined;
  const related = app.entities.filter((o) => o.key !== entity && Object.values(o.fields).some((f) => f.type === 'ref' && f.entity === entity));
  async function move(value: string) { setMsg(null); try { await api(`/tenant/p/${entity}/${id}`, { method: 'PATCH', body: { [stateKey!]: value } }); setMsg({ ok: true, text: t('saved') }); res.reload(); } catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); } }
  async function remove() { if (!window.confirm(t('confirmDelete'))) return; try { await api(`/tenant/p/${entity}/${id}`, { method: 'DELETE' }); router.push(`/app/e/${entity}`); } catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); } }
  const readOnlyKeys = Object.entries(def.fields).filter(([, f]) => f.readonly);
  return (
    <>
      <div className="row between"><div><Link href={`/app/e/${entity}`} className="small">← {app.label(def)}</Link><h1 style={{ fontSize: '1.6rem', margin: 0 }}>{app.recTitle(def, rec)}</h1></div>
        <div className="row">{def.canUpdate && !def.noUpdate && <button className="btn" onClick={() => setEditing((e) => !e)}>{editing ? t('cancel') : t('edit')}</button>}{def.canDelete && !def.noDelete && <button className="btn danger" onClick={remove}>{t('delete')}</button>}</div></div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role="alert">{msg.text}</div>}
      {stateKey && stateField && def.canUpdate && !def.noUpdate && (
        <div className="card flat"><div className="row"><b>{fieldLabel(stateKey, locale)}:</b><Cell field={stateField} value={rec.data[stateKey]} /><span className="grow" />
          {stateField.values!.filter((v) => v !== rec.data[stateKey]).map((v) => <button key={v} className="btn sm" onClick={() => move(v)}>{enumLabel(v, locale)}</button>)}</div></div>)}
      {editing ? <div className="card"><EntityForm def={def} record={rec} onSaved={() => { setEditing(false); setMsg({ ok: true, text: t('saved') }); res.reload(); }} /></div> : (
        <div className="card"><dl className="dl">
          {rec.code && <><dt>{t('code')}</dt><dd className="mono">{rec.code}</dd></>}
          {Object.entries(def.fields).map(([k, f]) => <div key={k} style={{ display: 'contents' }}><dt>{fieldLabel(k, locale)}</dt><dd><Cell field={f} value={rec.data[k]} name={k} /></dd></div>)}
          <dt>{t('createdAt')}</dt><dd className="mono">{new Date(rec.createdAt).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')}</dd></dl>
          {readOnlyKeys.length > 0 && <p className="muted small">{locale === 'ar' ? 'الحقول المحسوبة تُدار بواسطة النظام.' : 'Computed fields are managed by the system.'}</p>}</div>)}
      {related.length > 0 && <div className="card flat"><h3>{locale === 'ar' ? 'سجلات مرتبطة' : 'Related'}</h3><div className="row">{related.map((o) => { const k = Object.entries(o.fields).find(([, f]) => f.type === 'ref' && f.entity === entity)![0]; return (
        <span key={o.key} className="row" style={{ gap: 6 }}>{o.filterable.includes(k) && <Link className="btn sm" href={`/app/e/${o.key}?${k}=${id}`}>{app.label(o)}</Link>}{o.canCreate && <Link className="btn sm primary" href={`/app/e/${o.key}/new?${k}=${id}`}>+ {app.label(o)}</Link>}</span>); })}</div></div>}
      <Attachments entity={entity} id={id} />
    </>
  );
}
