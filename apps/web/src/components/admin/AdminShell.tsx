'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/lib/api';
import { LocaleSwitch, ThemeToggle, useI18n } from '../Providers';
import { Icon } from '../Icon';

export function AdminShell({ children }: { children: ReactNode }) {
  const { t, locale } = useI18n(); const path = usePathname(); const router = useRouter(); const [role, setRole] = useState<string | null>(null); const [open, setOpen] = useState(false); const login = path === '/admin/login';
  useEffect(() => { if (login) return; api<{ role: string }>('/platform/me', { scope: 'platform' }).then((r) => setRole(r.data.role)).catch((e: ApiError) => e.status === 401 && router.replace('/admin/login')); }, [login, router]);
  if (login) return <>{children}</>;
  if (!role) return <div className="auth"><div className="skeleton" style={{ width: 240, height: 24 }} /></div>;
  const item = (href: string, label: string, exact = false, icon = 'list') => <Link key={href} className="item" href={href} aria-current={(exact ? path === href : path.startsWith(href)) ? 'page' : undefined} onClick={() => setOpen(false)}><Icon name={icon} size={17} /><span>{label}</span></Link>;
  return (
    <div className="shell admin-shell">
      <aside id="admin-nav" className={`sidebar${open ? ' open' : ''}`} aria-label="Navigation"><div className="brand"><span className="dot" style={{ background: 'var(--signal)', color: 'var(--ink)' }}><Icon name="shield" size={18} /></span><span className="t"><span>Codela Admin</span><small>{locale === 'ar' ? 'إدارة المنصة' : 'Platform console'}</small></span></div>
        {item('/admin', t('analytics'), true, 'chart')}{item('/admin/tenants', t('tenants'), false, 'building')}{item('/admin/payments', locale === 'ar' ? 'المدفوعات' : 'Payments', false, 'card')}{item('/admin/leads', t('leads'), false, 'inbox')}
        <div className="nav-label">{locale === 'ar' ? 'الكتالوج' : 'Catalogue'}</div>{item('/admin/plans', t('plans'), false, 'layers')}{item('/admin/addons', locale === 'ar' ? 'الإضافات' : 'Add-ons', false, 'sparkle')}
        <div className="nav-label">{locale === 'ar' ? 'التواصل' : 'Communication'}</div>{item('/admin/announcements', locale === 'ar' ? 'الإعلانات' : 'Announcements', false, 'bell')}{item('/admin/templates', locale === 'ar' ? 'قوالب الإشعارات' : 'Templates', false, 'mail')}
        <div className="nav-label">{locale === 'ar' ? 'النظام' : 'System'}</div>{item('/admin/security', locale === 'ar' ? 'الأمان' : 'Security', false, 'shield')}{item('/admin/settings', locale === 'ar' ? 'الإعدادات' : 'Settings', false, 'settings')}</aside>
      <div className={`sb-backdrop${open ? ' open' : ''}`} onClick={() => setOpen(false)} aria-hidden="true" />
      <div style={{ minWidth: 0 }}><header className="topbar"><button className="icon-btn menu-btn" onClick={() => setOpen((o) => !o)} aria-label={locale === 'ar' ? 'القائمة' : 'Menu'} aria-expanded={open} aria-controls="admin-nav"><Icon name="menu" size={20} /></button><span className="badge info">{role}</span><span className="grow" /><LocaleSwitch /><ThemeToggle />
        <button className="btn sm" onClick={async () => { await api('/platform/auth/logout', { method: 'POST', scope: 'platform' }).catch(() => {}); router.replace('/admin/login'); }}><Icon name="logout" size={15} className="flip" />{t('logout')}</button></header>
        <main className="main-pane" id="main" tabIndex={-1}>{children}</main></div>
    </div>
  );
}
