import Link from 'next/link';
import type { ReactNode } from 'react';
import { LocaleSwitch, ThemeToggle } from './Providers';
import { t, type Locale } from '@/lib/i18n';

export function SiteHeader({ locale }: { locale: Locale }) {
  return (
    <header className="site-header">
      <div className="container row between">
        <Link href="/" className="logo" style={{ textDecoration: 'none' }}>codela<i>.</i></Link>
        <nav className="main" aria-label="Main">
          <Link href="/#products">{t('products', locale)}</Link><Link href="/pricing">{t('pricing', locale)}</Link><Link href="/contact">{t('contact', locale)}</Link>
          <LocaleSwitch /><ThemeToggle /><Link className="btn sm" href="/login">{t('login', locale)}</Link><Link className="btn sm primary" href="/register">{t('register', locale)}</Link>
        </nav>
      </div>
    </header>
  );
}
export function SiteFooter({ locale }: { locale: Locale }) {
  return (
    <footer className="site-footer"><div className="container row between"><div><b style={{ color: '#fff' }}>CODELA TECHNOLOGY</b><div className="small">{locale === 'ar' ? 'نشاط واحد. موقع واحد. نظام متكامل.' : 'One business. One website. One complete system.'}</div></div>
      <div className="row"><Link href="/pricing">{t('pricing', locale)}</Link><Link href="/contact">{t('contact', locale)}</Link><Link href="/login">{t('login', locale)}</Link></div></div></footer>
  );
}
export const Page = ({ children }: { children: ReactNode }) => <main id="main">{children}</main>;
