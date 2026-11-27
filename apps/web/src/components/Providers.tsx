'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { t as translate, type Locale } from '@/lib/i18n';
import { Icon } from './Icon';

const Ctx = createContext<{ locale: Locale; t: (k: string) => string; setLocale: (l: Locale) => void }>({ locale: 'ar', t: (k) => k, setLocale: () => {} });
export const useI18n = () => useContext(Ctx);

/* ---- toasts + confirm dialog: module-level emitters so any component (or plain handler) can call them ---- */
type Toast = { id: number; text: string; tone: 'ok' | 'error' | 'info' };
type ConfirmReq = { message: string; title?: string; confirmLabel?: string; danger?: boolean; resolve: (ok: boolean) => void };
let pushToast: (t: Omit<Toast, 'id'>) => void = () => {};
let askConfirm: (r: ConfirmReq) => void = (r) => r.resolve(typeof window !== 'undefined' && window.confirm(r.message));
/** Short status message in the corner (role=status, auto-dismiss after 4.5s; errors stay 8s). */
export const toast = (text: string, tone: Toast['tone'] = 'ok') => pushToast({ text, tone });
/** Accessible replacement for window.confirm(): resolves true when the person confirms. */
export const confirmDialog = (message: string, o: { title?: string; confirmLabel?: string; danger?: boolean } = {}) => new Promise<boolean>((resolve) => askConfirm({ message, ...o, resolve }));

function Overlays({ locale }: { locale: Locale }) {
  const [toasts, setToasts] = useState<Toast[]>([]); const [req, setReq] = useState<ConfirmReq | null>(null); const dlg = useRef<HTMLDialogElement>(null); const seq = useRef(0);
  const drop = useCallback((id: number) => setToasts((x) => x.filter((t) => t.id !== id)), []);
  useEffect(() => {
    pushToast = (t) => { const id = ++seq.current; setToasts((x) => [...x.slice(-3), { ...t, id }]); setTimeout(() => drop(id), t.tone === 'error' ? 8000 : 4500); };
    askConfirm = (r) => setReq(r);
  }, [drop]);
  useEffect(() => { if (req && dlg.current && !dlg.current.open) dlg.current.showModal(); }, [req]);
  const close = (ok: boolean) => { req?.resolve(ok); dlg.current?.close(); setReq(null); };
  const tr = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  return (
    <>
      <div className="toasts" role="status" aria-live="polite">{toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}><Icon name={t.tone === 'error' ? 'alert' : t.tone === 'ok' ? 'checkCircle' : 'info'} /><span className="grow">{t.text}</span><button type="button" onClick={() => drop(t.id)} aria-label={tr('إغلاق', 'Dismiss')}><Icon name="x" size={16} /></button></div>))}</div>
      <dialog ref={dlg} className="modal" aria-labelledby="confirm-title" onCancel={(e) => { e.preventDefault(); close(false); }}>
        {req && <form method="dialog" onSubmit={(e) => { e.preventDefault(); close(true); }}>
          <div className="modal-body"><h2 id="confirm-title">{req.title ?? tr('تأكيد', 'Please confirm')}</h2><p>{req.message}</p></div>
          <div className="modal-actions"><button type="button" className="btn" onClick={() => close(false)} autoFocus>{tr('إلغاء', 'Cancel')}</button>
            <button type="submit" className={`btn primary${req.danger ? ' danger-solid' : ''}`}>{req.confirmLabel ?? tr('تأكيد', 'Confirm')}</button></div>
        </form>}
      </dialog>
    </>
  );
}

export function Providers({ locale: initial, children }: { locale: Locale; children: ReactNode }) {
  const [locale, set] = useState<Locale>(initial);
  useEffect(() => { try { const th = localStorage.getItem('theme'); if (th) document.documentElement.dataset.theme = th; } catch { /* storage unavailable */ } }, []);
  const setLocale = (l: Locale) => { document.cookie = `locale=${l}; path=/; max-age=31536000; samesite=lax`; set(l); document.documentElement.lang = l; document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr'; };
  return <Ctx.Provider value={{ locale, t: (k) => translate(k, locale), setLocale }}>{children}<Overlays locale={locale} /></Ctx.Provider>;
}

export function LocaleSwitch() {
  const { locale, setLocale, t } = useI18n();
  return <button className="btn sm" type="button" onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')} lang={locale === 'ar' ? 'en' : 'ar'}>{t('language')}</button>;
}
export function ThemeToggle() {
  const { t } = useI18n();
  const flip = () => { const cur = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = cur; try { localStorage.setItem('theme', cur); } catch { /* ignore */ } };
  return <button className="btn sm icon-only" type="button" onClick={flip} aria-label={t('theme')} title={t('theme')}><Icon name="moon" size={16} /></button>;
}
/** Current theme (follows the OS until the person picks one) + a setter that persists the choice. */
export function useTheme(): [string, () => void] {
  const [th, setTh] = useState('light');
  useEffect(() => { const d = document.documentElement.dataset.theme; setTh(d ?? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')); }, []);
  const flip = () => { const cur = th === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = cur; setTh(cur); try { localStorage.setItem('theme', cur); } catch { /* ignore */ } };
  return [th, flip];
}
