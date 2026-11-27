import Link from 'next/link';
import type { ReactNode } from 'react';
import { LocaleSwitch, ThemeToggle } from './Providers';
import { Icon, PRODUCT_ICON } from './Icon';
import { PRODUCT_NAMES } from '@/lib/content';
import { t, type Locale } from '@/lib/i18n';

export const Logo = () => <Link href="/" className="logo" aria-label="Codela home"><span className="mark" aria-hidden="true">c</span><span>codela<i>.</i></span></Link>;

export function SiteHeader({ locale }: { locale: Locale }) {
  return (
    <header className="site-header">
      <div className="container row between">
        <Logo />
        <nav className="main" aria-label="Main">
          <Link href="/#products" className="hide-sm">{t('products', locale)}</Link><Link href="/pricing" className="hide-sm">{t('pricing', locale)}</Link><Link href="/contact" className="hide-sm">{t('contact', locale)}</Link>
          <span className="nav-sep hide-sm" aria-hidden="true" />
          <LocaleSwitch /><ThemeToggle /><Link className="btn sm ghost hide-xs" href="/login">{t('login', locale)}</Link><Link className="btn sm primary" href="/register">{t('register', locale)}</Link>
        </nav>
      </div>
    </header>
  );
}
export function SiteFooter({ locale }: { locale: Locale }) {
  const L = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  return (
    <footer className="site-footer"><div className="container">
      <div className="footer-grid">
        <div className="stack" style={{ gap: 10 }}><span className="logo" style={{ color: '#fff' }}><span className="mark" aria-hidden="true">c</span>codela<i>.</i></span>
          <p style={{ maxWidth: '34ch', margin: 0 }}>{L('عشرة منتجات متخصصة على منصة واحدة: موقع احترافي ونظام إدارة متكامل لكل نشاط.', 'Ten specialised products on one platform: a professional website and a complete management system for every business.')}</p></div>
        <nav aria-label={L('المنتجات', 'Products')}><h3>{L('المنتجات', 'Products')}</h3><ul>{Object.keys(PRODUCT_NAMES).map((s) => <li key={s}><Link href={`/products/${s}`}>{PRODUCT_NAMES[s][locale]}</Link></li>)}</ul></nav>
        <nav aria-label={L('الشركة', 'Company')}><h3>{L('الشركة', 'Company')}</h3><ul><li><Link href="/pricing">{t('pricing', locale)}</Link></li><li><Link href="/contact">{t('contact', locale)}</Link></li><li><Link href="/contact">{t('requestDemo', locale)}</Link></li></ul></nav>
        <nav aria-label={L('الحساب', 'Account')}><h3>{L('الحساب', 'Account')}</h3><ul><li><Link href="/login">{t('login', locale)}</Link></li><li><Link href="/register">{t('register', locale)}</Link></li><li><Link href="/recover">{L('استعادة كلمة المرور', 'Reset password')}</Link></li></ul></nav>
      </div>
      <div className="footer-base"><span>© {new Date().getFullYear()} Codela Technology</span><span>{L('نشاط واحد. موقع واحد. نظام متكامل.', 'One business. One website. One complete system.')}</span></div>
    </div></footer>
  );
}
export const Page = ({ children }: { children: ReactNode }) => <main id="main">{children}</main>;

/** Decorative product preview for the marketing hero: a miniature dashboard drawn in HTML (no screenshot to go stale). */
export function HeroPreview({ locale }: { locale: Locale }) {
  const L = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const bars = [38, 52, 44, 61, 58, 72, 66, 81, 77, 90, 84, 96];
  return (
    <div className="hp-window" aria-hidden="true">
      <div className="hp-chrome"><i /><i /><i /><span>app.codela.tech</span></div>
      <div className="hp-body">
        <div className="hp-side">{(['home', 'calendar', 'users', 'receipt', 'chart', 'globe', 'settings'] as const).map((n, i) => <span key={n} className={i === 1 ? 'on' : undefined}><Icon name={n} size={15} /></span>)}</div>
        <div className="hp-main">
          <div className="hp-row"><b>{L('صباح الخير، سارة', 'Good morning, Sara')}</b><span className="hp-pill">{L('مواعيد اليوم', 'Today')} · 24</span></div>
          <div className="hp-kpis">{[[L('الإيراد هذا الشهر', 'Revenue this month'), '184,250', 'EGP'], [L('مواعيد اليوم', 'Appointments today'), '24', ''], [L('فواتير مستحقة', 'Outstanding'), '12,900', 'EGP']].map(([a, b, c]) => <div key={a}><span>{a}</span><b>{b}<small>{c}</small></b></div>)}</div>
          <div className="hp-chart"><span>{L('الإيراد — آخر ١٢ أسبوعًا', 'Revenue — last 12 weeks')}</span><div>{bars.map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</div></div>
          <div className="hp-list">{[[L('أحمد سمير', 'Ahmed Samir'), L('كشف', 'Check-up'), 'ok'], [L('منى خالد', 'Mona Khaled'), L('متابعة', 'Follow-up'), 'warn'], [L('يوسف علي', 'Youssef Ali'), L('أشعة', 'X-ray'), 'ok']].map(([n, s, tone], i) => <div key={i}><span className="hp-av">{n.slice(0, 1)}</span><span>{n}<small>{s}</small></span><em className={tone}>{tone === 'ok' ? L('مؤكد', 'Confirmed') : L('بانتظار', 'Waiting')}</em></div>)}</div>
        </div>
      </div>
    </div>
  );
}
export const productIcon = (s: string) => <Icon name={PRODUCT_ICON[s] ?? 'grid'} size={20} />;
