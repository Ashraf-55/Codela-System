'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { t as translate, type Locale } from '@/lib/i18n';

const Ctx = createContext<{ locale: Locale; t: (k: string) => string; setLocale: (l: Locale) => void }>({ locale: 'ar', t: (k) => k, setLocale: () => {} });
export const useI18n = () => useContext(Ctx);

export function Providers({ locale: initial, children }: { locale: Locale; children: ReactNode }) {
  const [locale, set] = useState<Locale>(initial);
  useEffect(() => { try { const th = localStorage.getItem('theme'); if (th) document.documentElement.dataset.theme = th; } catch { /* storage unavailable */ } }, []);
  const setLocale = (l: Locale) => { document.cookie = `locale=${l}; path=/; max-age=31536000; samesite=lax`; set(l); document.documentElement.lang = l; document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr'; };
  return <Ctx.Provider value={{ locale, t: (k) => translate(k, locale), setLocale }}>{children}</Ctx.Provider>;
}

export function LocaleSwitch() {
  const { locale, setLocale, t } = useI18n();
  return <button className="btn sm" type="button" onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')} lang={locale === 'ar' ? 'en' : 'ar'}>{t('language')}</button>;
}
export function ThemeToggle() {
  const { t } = useI18n();
  const flip = () => { const cur = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = cur; try { localStorage.setItem('theme', cur); } catch { /* ignore */ } };
  return <button className="btn sm" type="button" onClick={flip} aria-label={t('theme')}>◐</button>;
}
