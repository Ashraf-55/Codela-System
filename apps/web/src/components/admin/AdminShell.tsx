'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/lib/api';
import { LocaleSwitch, ThemeToggle, useI18n } from '../Providers';

export function AdminShell({ children }: { children: ReactNode }) {
  const { t, locale } = useI18n(); const path = usePathname(); const router = useRouter(); const [role, setRole] = useState<string | null>(null); const login = path === '/admin/login';
  useEffect(() => { if (login) return; api<{ role: string }>('/platform/me', { scope: 'platform' }).then((r) => setRole(r.data.role)).catch((e: ApiError) => e.status === 401 && router.replace('/admin/login')); }, [login, router]);
  if (login) return <>{children}</>;
  if (!role) return <div className="auth"><div className="skeleton" style={{ width: 240, height: 24 }} /></div>;
  const item = (href: string, label: string, exact = false) => <Link key={href} className="item" href={href} aria-current={(exact ? path === href : path.startsWith(href)) ? 'page' : undefined}>{label}</Link>;
  return (
    <div className="shell">
      <aside className="sidebar"><div className="brand"><span className="dot" />Codela Admin</div>{item('/admin', t('analytics'), true)}{item('/admin/security', locale === 'ar' ? 'الأمان' : 'Security')}{item('/admin/tenants', t('tenants'))}{item('/admin/plans', t('plans'))}{item('/admin/payments', locale === 'ar' ? 'المدفوعات' : 'Payments')}{item('/admin/addons', locale === 'ar' ? 'الإضافات' : 'Add-ons')}{item('/admin/announcements', locale === 'ar' ? 'الإعلانات' : 'Announcements')}{item('/admin/templates', locale === 'ar' ? 'قوالب الإشعارات' : 'Templates')}{item('/admin/leads', t('leads'))}{item('/admin/settings', locale === 'ar' ? 'الإعدادات' : 'Settings')}</aside>
      <div style={{ minWidth: 0 }}><div className="topbar"><span className="badge info">{role}</span><span className="grow" /><LocaleSwitch /><ThemeToggle />
        <button className="btn sm" onClick={async () => { await api('/platform/auth/logout', { method: 'POST', scope: 'platform' }).catch(() => {}); router.replace('/admin/login'); }}>{t('logout')}</button></div>
        <div className="main-pane" id="main">{children}</div></div>
    </div>
  );
}
