'use client';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { fromMinor, toMinor } from '@codela/shared';
import { ApiError, api, uploadFile } from '@/lib/api';
import { enumLabel, fieldLabel } from '@/lib/i18n';
import { useI18n } from '../Providers';
import { useApp, type EntityMeta, type FieldMeta, type Rec } from './AppShell';

type Raw = any;
const toRaw = (f: FieldMeta, v: unknown, currency: string): Raw => {
  if (v === null || v === undefined) return f.type === 'bool' ? false : f.type === 'lines' ? [] : '';
  if (f.type === 'money') return fromMinor(Number(v), currency);
  if (f.type === 'datetime') return String(v).slice(0, 16);
  if (f.type === 'lines') return (v as Record<string, unknown>[]).map((r) => Object.fromEntries(Object.entries(f.fields ?? {}).map(([k, sf]) => [k, toRaw(sf, r[k], currency)])));
  return f.type === 'int' ? String(v) : v;
};
function fromRaw(f: FieldMeta, v: Raw, currency: string): unknown {
  if (f.type === 'bool') return !!v;
  if (f.type === 'lines') return (v as Record<string, Raw>[]).map((r) => Object.fromEntries(Object.entries(f.fields ?? {}).filter(([k]) => r[k] !== '' && r[k] !== undefined).map(([k, sf]) => [k, fromRaw(sf, r[k], currency)]))).filter((r) => Object.keys(r).length);
  if (v === '' || v === undefined || v === null) return undefined;
  if (f.type === 'int') { const n = Number(v); if (!Number.isFinite(n)) throw new Error('number'); return n; }
  if (f.type === 'money') return toMinor(String(v), currency);
  if (f.type === 'datetime') return new Date(String(v)).toISOString();
  return typeof v === 'string' ? v.trim() : v;
}
const inputType = (t: string) => ({ email: 'email', phone: 'tel', url: 'url', date: 'date', time: 'time', datetime: 'datetime-local', int: 'text', money: 'text' } as Record<string, string>)[t] ?? 'text';

export function EntityForm({ def, record, prefill, onSaved }: { def: EntityMeta; record?: Rec; prefill?: Record<string, string>; onSaved: (r: Rec) => void }) {
  const { t, locale } = useI18n(); const app = useApp(); const fields = useMemo(() => Object.entries(def.fields).filter(([, f]) => !f.readonly), [def]);
  const init = useMemo(() => Object.fromEntries(fields.map(([k, f]) => [k, record ? toRaw(f, record.data[k], app.currency) : prefill?.[k] ?? (f.default !== undefined ? toRaw(f, f.default, app.currency) : f.type === 'bool' ? false : f.type === 'lines' ? [] : '')])), [fields, record, prefill, app.currency]);
  const [vals, setVals] = useState<Record<string, Raw>>(init); const [errs, setErrs] = useState<Record<string, string[]>>({}); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { app.ensureRefs(fields.flatMap(([, f]) => [f.entity, ...Object.values(f.fields ?? {}).map((s) => s.entity)])); }, [fields, app]);
  const set = (k: string, v: Raw) => setVals((p) => ({ ...p, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErrs({}); setMsg('');
    try {
      const body: Record<string, unknown> = {};
      for (const [k, f] of fields) {
        let v: unknown; try { v = fromRaw(f, vals[k], app.currency); } catch { setErrs({ [k]: [fieldLabel(k, locale) + ': invalid'] }); setBusy(false); return; }
        if (record) { const before = fromRaw(f, init[k], app.currency); if (JSON.stringify(v) === JSON.stringify(before)) continue; body[k] = v === undefined ? null : v; } else if (v !== undefined) body[k] = v;
      }
      if (record && !Object.keys(body).length) { setMsg(t('saved')); setBusy(false); return; }
      const r = await api<Rec>(record ? `/tenant/p/${def.key}/${record.id}` : `/tenant/p/${def.key}`, { method: record ? 'PATCH' : 'POST', body }); onSaved(r.data);
    } catch (x) { const a = x as ApiError; setErrs(a.fields ?? {}); setMsg(a.message); setBusy(false); }
  }
  const control = (k: string, f: FieldMeta, v: Raw, on: (v: Raw) => void, id: string) => {
    const a = errs[k] ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-err` } : {};
    if (f.type === 'bool') return <input id={id} {...a} type="checkbox" checked={!!v} onChange={(e) => on(e.target.checked)} />;
    if (f.type === 'enum') return <select id={id} {...a} value={v ?? ''} onChange={(e) => on(e.target.value)}><option value="">{t('select')}</option>{f.values!.map((o) => <option key={o} value={o}>{enumLabel(o, locale)}</option>)}</select>;
    if (f.type === 'ref') return <select id={id} {...a} value={v ?? ''} onChange={(e) => on(e.target.value)}><option value="">{t('select')}</option>{app.refOptions(f.entity!).map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}</select>;
    if (f.type === 'text') return <textarea id={id} {...a} value={v ?? ''} onChange={(e) => on(e.target.value)} />;
    if (f.type === 'url' && k === 'image') return ( // image: paste an https URL or upload a file (stored as a public file path, so type=text rather than type=url)
      <span className="row"><input id={id} {...a} type="text" className="ltr" value={v ?? ''} onChange={(e) => on(e.target.value)} />
        <label className="btn sm">{locale === 'ar' ? 'رفع صورة' : 'Upload image'}<input type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; try { const r = await uploadFile('product', file); on(r.url); } catch (x) { setMsg((x as ApiError).message); } }} /></label></span>
    );
    return <input id={id} {...a} type={inputType(f.type)} inputMode={f.type === 'int' || f.type === 'money' ? 'decimal' : undefined} className={['email', 'phone', 'url', 'money', 'int', 'date', 'time', 'datetime'].includes(f.type) ? 'ltr' : undefined} value={v ?? ''} onChange={(e) => on(e.target.value)} />;
  };
  return (
    <form className="stack" onSubmit={submit} noValidate>
      {msg && <div className={`alert ${Object.keys(errs).length || msg !== t('saved') ? 'error' : 'ok'}`} role="alert">{msg}</div>}
      <div className="grid g2">
        {fields.map(([k, f]) => f.type === 'lines' ? (
          <fieldset key={k} className="card flat" style={{ gridColumn: '1 / -1' }}><legend>{fieldLabel(k, locale)}</legend>
            <div className="stack">{(vals[k] as Raw[]).map((row, i) => (
              <div key={i} className="row" style={{ alignItems: 'end' }}>{Object.entries(f.fields ?? {}).map(([sk, sf]) => (
                <label key={sk} className="field grow" style={{ minWidth: 120 }}>{fieldLabel(sk, locale)}{control(sk, sf, row[sk], (nv) => set(k, (vals[k] as Raw[]).map((r, j) => (j === i ? { ...r, [sk]: nv } : r))), `${k}-${i}-${sk}`)}<span className="err">{errs[`${k}.${i}.${sk}`]?.join(', ')}</span></label>))}
                <button type="button" className="btn sm danger" onClick={() => set(k, (vals[k] as Raw[]).filter((_, j) => j !== i))}>{t('remove')}</button></div>))}
              <div><button type="button" className="btn sm" onClick={() => set(k, [...(vals[k] as Raw[]), Object.fromEntries(Object.entries(f.fields ?? {}).map(([sk, sf]) => [sk, sf.default !== undefined ? toRaw(sf, sf.default, app.currency) : sf.type === 'bool' ? false : '']))])}>{t('addRow')}</button></div>
              {errs[k] && <span className="err" role="alert">{errs[k].join(', ')}</span>}</div></fieldset>
        ) : (
          <label key={k} className="field" htmlFor={`f-${k}`}><span>{fieldLabel(k, locale)}{f.required && <span className="req" aria-hidden="true">*</span>}{f.required && <span className="sr-only">{locale === 'ar' ? ' (مطلوب)' : ' (required)'}</span>}</span>{control(k, f, vals[k], (v) => set(k, v), `f-${k}`)}
            {f.type === 'money' && <span className="hint">{app.currency}</span>}{errs[k] && <span className="err" id={`f-${k}-err`} role="alert">{errs[k].join(', ')}</span>}</label>
        ))}
      </div>
      <div className="row" style={{ paddingTop: 4 }}><button className="btn primary" disabled={busy} aria-busy={busy}>{busy ? (locale === 'ar' ? 'جارٍ الحفظ…' : 'Saving…') : t('save')}</button></div>
    </form>
  );
}
