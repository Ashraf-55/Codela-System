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
import { confirmDialog, toast, useI18n } from '@/components/Providers';
import { Icon } from '@/components/Icon';

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
  async function remove() { if (!(await confirmDialog(t('confirmDelete'), { confirmLabel: t('delete'), danger: true }))) return; try { await api(`/tenant/p/${entity}/${id}`, { method: 'DELETE' }); toast(locale === 'ar' ? 'تم الحذف' : 'Deleted'); router.push(`/app/e/${entity}`); } catch (e) { setMsg({ ok: false, text: (e as ApiError).message }); } }
  const readOnlyKeys = Object.entries(def.fields).filter(([, f]) => f.readonly);
  return (
    <>
      <div className="page-head"><div><nav aria-label={locale === 'ar' ? 'مسار التنقل' : 'Breadcrumb'} className="small row" style={{ gap: 4 }}><Link href={`/app/e/${entity}`}>{app.label(def)}</Link><Icon name={locale === 'ar' ? 'chevronLeft' : 'chevronRight'} size={14} /><span className="muted" aria-current="page">{rec.code ?? app.recTitle(def, rec)}</span></nav>
        <h1 style={{ marginTop: 4 }}>{app.recTitle(def, rec)}</h1></div>
        <div className="actions">{def.canUpdate && !def.noUpdate && <button className="btn" onClick={() => setEditing((e) => !e)}>{!editing && <Icon name="edit" size={16} />}{editing ? t('cancel') : t('edit')}</button>}{def.canDelete && !def.noDelete && <button className="btn danger" onClick={remove}><Icon name="trash" size={16} />{t('delete')}</button>}</div></div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role="alert">{msg.text}</div>}
      {stateKey && stateField && def.canUpdate && !def.noUpdate && (
        <div className="card" style={{ padding: '14px 18px' }}><div className="row"><span className="muted small">{fieldLabel(stateKey, locale)}</span><Cell field={stateField} value={rec.data[stateKey]} /><span className="grow" />
          <span className="muted small">{locale === 'ar' ? 'نقل إلى' : 'Move to'}</span>{stateField.values!.filter((v) => v !== rec.data[stateKey]).map((v) => <button key={v} className="btn sm" onClick={() => move(v)}>{enumLabel(v, locale)}</button>)}</div></div>)}
      {editing ? <div className="card"><EntityForm def={def} record={rec} onSaved={() => { setEditing(false); setMsg({ ok: true, text: t('saved') }); res.reload(); }} /></div> : (
        <div className="card"><dl className="dl">
          {rec.code && <><dt>{t('code')}</dt><dd className="mono">{rec.code}</dd></>}
          {Object.entries(def.fields).map(([k, f]) => <div key={k} style={{ display: 'contents' }}><dt>{fieldLabel(k, locale)}</dt><dd><Cell field={f} value={rec.data[k]} name={k} /></dd></div>)}
          <dt>{t('createdAt')}</dt><dd className="mono">{new Date(rec.createdAt).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')}</dd></dl>
          {readOnlyKeys.length > 0 && <p className="muted small">{locale === 'ar' ? 'الحقول المحسوبة تُدار بواسطة النظام.' : 'Computed fields are managed by the system.'}</p>}</div>)}
      {related.length > 0 && <div className="card"><h3>{locale === 'ar' ? 'سجلات مرتبطة' : 'Related records'}</h3><div className="row">{related.map((o) => { const k = Object.entries(o.fields).find(([, f]) => f.type === 'ref' && f.entity === entity)![0]; return (
        <span key={o.key} className="row" style={{ gap: 6 }}>{o.filterable.includes(k) && <Link className="btn sm" href={`/app/e/${o.key}?${k}=${id}`}>{app.label(o)}</Link>}{o.canCreate && <Link className="btn sm" href={`/app/e/${o.key}/new?${k}=${id}`} aria-label={`${locale === 'ar' ? 'إضافة' : 'Add'} ${app.label(o)}`}><Icon name="plus" size={14} />{app.label(o)}</Link>}</span>); })}</div></div>}
      <Attachments entity={entity} id={id} />
    </>
  );
}
