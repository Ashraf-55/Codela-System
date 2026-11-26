'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { themeToCssVars, type ProductSlug } from '@codela/design';
import { api, ApiError } from '@/lib/api';
import { fmtMoney, type Locale } from '@/lib/i18n';
import { BOARDS } from '@/lib/boards';
import { fontsHref } from '@/lib/fonts';
import { LocaleSwitch, ThemeToggle, useI18n } from '../Providers';

export interface FieldMeta { type: string; required: boolean; readonly: boolean; values?: string[]; entity?: string; default?: unknown; fields?: Record<string, FieldMeta> }
export interface EntityMeta { key: string; module: string; labelEn: string; labelAr: string; titleField: string; filterable: string[]; noDelete: boolean; noUpdate: boolean; autoCode: boolean; canExport?: boolean; canApprove?: boolean; canCreate: boolean; canUpdate: boolean; canDelete: boolean; fields: Record<string, FieldMeta> }
export interface Me { user: { id: string; email: string; name: string }; tenant: { id: string; slug: string; name: string; productSlug: string; currency: string }; role: string; permissions: string[] }
export interface Rec { id: string; code: string | null; entityType: string; data: Record<string, any>; createdAt: string; updatedAt: string }
interface Ctx {
  me: Me; entities: EntityMeta[]; locale: Locale; currency: string; entity: (k: string) => EntityMeta | undefined; label: (e: EntityMeta) => string;
  recTitle: (e: EntityMeta, r: Rec) => string; refTitle: (entity: string | undefined, id: unknown) => string; ensureRefs: (keys: (string | undefined)[]) => void; refOptions: (entity: string) => { id: string; title: string }[];
  can: (perm: string) => boolean; money: (n: number) => string;
}
const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => { const c = useContext(AppCtx); if (!c) throw new Error('outside AppShell'); return c; };

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, set] = useState<{ loading: boolean; error: ApiError | null; data: T | null }>({ loading: true, error: null, data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => { let live = true; set((s) => ({ ...s, loading: true, error: null })); fn().then((data) => live && set({ loading: false, error: null, data })).catch((e) => live && set({ loading: false, error: e as ApiError, data: null })); return () => { live = false; }; },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [...deps, tick]);
  return { ...state, reload: () => setTick((x) => x + 1) };
}
export const Loading = () => <div className="stack" aria-busy="true"><div className="skeleton" style={{ height: 28, width: '40%' }} /><div className="skeleton" style={{ height: 120 }} /></div>;
export function ErrorBox({ error, retry }: { error: ApiError; retry?: () => void }) {
  const { t } = useI18n(); return <div className="alert error" role="alert">{error.message}{retry && <> <button className="btn sm" onClick={retry}>{t('retry')}</button></>}</div>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { locale, t } = useI18n(); const router = useRouter(); const path = usePathname();
  const [state, setState] = useState<{ me: Me; entities: EntityMeta[] } | null>(null); const [err, setErr] = useState<ApiError | null>(null); const [open, setOpen] = useState(false);
  const [refs, setRefs] = useState<Record<string, { id: string; title: string }[]>>({}); const asked = useRef(new Set<string>());
  const [anns, setAnns] = useState<{ id: string; titleAr: string; titleEn: string; bodyAr: string; bodyEn: string; level: string }[]>([]); const [unread, setUnread] = useState(0); const [access, setAccess] = useState<{ access: string; status: string; trialEndsAt: string | null } | null>(null);

  useEffect(() => {
    api<Me>('/auth/me').then(async (m) => {
      if (m.data.permissions.includes('driver.use') && !m.data.permissions.includes('*')) { router.replace('/driver'); return; } // drivers only get the driver portal
      const p = await api<{ entities: EntityMeta[] }>('/tenant/p-meta'); setState({ me: m.data, entities: p.data.entities });
    })
      .catch((e: ApiError) => { if (e.status === 401) router.replace('/login'); else setErr(e); });
  }, [router]);
  useEffect(() => { if (!state) return; api<any[]>('/tenant/notifications').then((r) => setUnread(r.data.filter((n) => !n.readAt).length)).catch(() => {}); api<any>('/tenant/subscription').then((r) => setAccess(r.data)).catch(() => {}); api<any[]>('/tenant/announcements').then((r) => setAnns(r.data)).catch(() => {}); }, [state, path]);

  const ensureRefs = useCallback((keys: (string | undefined)[]) => {
    for (const k of keys) {
      if (!k || asked.current.has(k) || !state?.entities.some((e) => e.key === k)) continue; asked.current.add(k);
      const def = state.entities.find((e) => e.key === k)!;
      api<Rec[]>(`/tenant/p/${k}?pageSize=100`).then((r) => setRefs((p) => ({ ...p, [k]: r.data.map((x) => ({ id: x.id, title: titleOf(def, x) })) }))).catch(() => {});
    }
  }, [state]);

  if (err) return <div className="auth"><div className="card stack"><div className="alert error" role="alert">{err.code === 'ACCOUNT_SUSPENDED' ? err.message : t('error') + ': ' + err.message}</div><Link className="btn" href="/login">{t('login')}</Link></div></div>;
  if (!state) return <div className="auth"><Loading /></div>;
  const { me, entities } = state; const currency = me.tenant.currency;
  const label = (e: EntityMeta) => (locale === 'ar' ? e.labelAr : e.labelEn);
  const ctx: Ctx = { me, entities, locale, currency, entity: (k) => entities.find((e) => e.key === k), label, recTitle: titleOf, ensureRefs, refOptions: (k) => refs[k] ?? [],
    refTitle: (k, id) => (id ? (k ? refs[k]?.find((x) => x.id === id)?.title : undefined) ?? String(id).slice(0, 8) : '—'),
    can: (perm) => me.permissions.includes('*') || me.permissions.includes(perm) || me.permissions.includes(perm.split('.')[0] + '.*'), money: (n) => fmtMoney(n, currency, locale) };
  const nav = (href: string, text: string, exact = false) => <Link key={href} className="item" href={href} aria-current={(exact ? path === href : path === href || path.startsWith(href + '/')) ? 'page' : undefined} onClick={() => setOpen(false)}>{text}</Link>;
  async function logout() { await api('/auth/logout', { method: 'POST' }).catch(() => {}); router.replace('/login'); }
  return (
    <AppCtx.Provider value={ctx}>
      <style>{themeToCssVars(me.tenant.productSlug as ProductSlug)}</style>
      <link rel="stylesheet" href={fontsHref(me.tenant.productSlug)} />
      <div className="shell" data-product={me.tenant.productSlug}>
        <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Navigation">
          <div className="brand"><span className="dot" />{me.tenant.name}</div>
          {nav('/app', t('dashboard'), true)}{BOARDS[me.tenant.productSlug] && entities.some((e) => e.key === BOARDS[me.tenant.productSlug].entity) && nav('/app/board', BOARDS[me.tenant.productSlug].title[locale])}{me.tenant.productSlug === 'realestate' && ctx.can('leads.read') && nav('/app/lead-performance', locale === 'ar' ? 'أداء العملاء المحتملين' : 'Lead performance')}{me.tenant.productSlug === 'business' && ctx.can('quotations.read') && nav('/app/quotations', locale === 'ar' ? 'عروض الأسعار' : 'Quotations')}{me.tenant.productSlug === 'business' && ctx.can('stock.read') && nav('/app/stock', locale === 'ar' ? 'المخزون حسب المخزن' : 'Stock by warehouse')}{me.tenant.productSlug === 'fleet' && ctx.can('collections.read') && nav('/app/cash', locale === 'ar' ? 'تحصيلات المناديب' : 'Driver cash')}{me.tenant.productSlug === 'automotive' && ctx.can('workOrders.read') && nav('/app/workorders', locale === 'ar' ? 'أوامر الشغل' : 'Work orders')}{me.tenant.productSlug === 'automotive' && ctx.can('warranties.read') && nav('/app/warranties', locale === 'ar' ? 'الضمان' : 'Warranties')}{me.tenant.productSlug === 'construction' && ctx.can('estimates.read') && nav('/app/estimates', locale === 'ar' ? 'المقايسات والمستخلصات' : 'Estimates & claims')}{me.tenant.productSlug === 'realestate' && ctx.can('commissions.read') && nav('/app/commissions', locale === 'ar' ? 'صرف العمولات' : 'Commission payouts')}{me.tenant.productSlug === 'realestate' && (ctx.can('sales.read') || ctx.can('rentals.read')) && nav('/app/contracts', locale === 'ar' ? 'العقود' : 'Contracts')}{me.tenant.productSlug === 'learning' && ctx.can('courses.read') && nav('/app/course-builder', locale === 'ar' ? 'بناء الكورس' : 'Course builder')}{Object.entries(BOARDS).filter(([k, c]) => k.startsWith(`${me.tenant.productSlug}:`) && entities.some((e) => e.key === c.entity)).map(([k, c]) => <span key={k}>{nav(`/app/board?b=${k.split(':')[1]}`, c.title[locale])}</span>)}{me.tenant.productSlug === 'medical' && ctx.can('dispensing.read') && nav('/app/pharmacy', locale === 'ar' ? 'الصيدلية' : 'Pharmacy')}{me.tenant.productSlug === 'medical' && ctx.can('labs.read') && nav('/app/lab', locale === 'ar' ? 'المعمل' : 'Laboratory')}{me.tenant.productSlug === 'medical' && ctx.can('imaging.read') && nav('/app/radiology', locale === 'ar' ? 'الأشعة' : 'Radiology')}{['booking', 'medical'].includes(me.tenant.productSlug) && nav('/app/calendar', locale === 'ar' ? 'التقويم' : 'Calendar')}{entities.find((e) => e.key === 'paymentRequest') && nav('/app/payments', locale === 'ar' ? 'مدفوعات العملاء' : 'Customer payments')}{me.tenant.productSlug === 'business' && entities.find((e) => e.key === 'attendance') && nav('/app/attendance', locale === 'ar' ? 'الحضور والانصراف' : 'Attendance')}{me.tenant.productSlug === 'business' && entities.find((e) => e.key === 'quotation') && nav('/app/board?b=quotations', locale === 'ar' ? 'عروض الأسعار' : 'Quotations')}{me.tenant.productSlug === 'business' && entities.find((e) => e.key === 'jobApplication') && nav('/app/board?b=applications', locale === 'ar' ? 'طلبات التوظيف' : 'Applications')}{me.tenant.productSlug === 'construction' && nav('/app/projects', locale === 'ar' ? 'لوحة المشاريع' : 'Project cockpit')}{me.tenant.productSlug === 'learning' && nav('/app/board?b=reviews', locale === 'ar' ? 'مراجعة التقييمات' : 'Review moderation')}{me.tenant.productSlug === 'fleet' && nav('/app/proofs', locale === 'ar' ? 'إثباتات التسليم' : 'Delivery proofs')}{me.tenant.productSlug === 'fleet' && ctx.can('employees.manage') && nav('/app/driver-accounts', locale === 'ar' ? 'حسابات المناديب' : 'Driver logins')}{me.tenant.productSlug === 'automotive' && nav('/app/board?b=requests', locale === 'ar' ? 'طلبات الحجز والأسعار' : 'Booking & quotes')}{me.tenant.productSlug === 'realestate' && nav('/app/board?b=leads', locale === 'ar' ? 'العملاء المحتملون' : 'Leads pipeline')}{me.tenant.productSlug === 'realestate' && nav('/app/board?b=viewings', locale === 'ar' ? 'المعاينات' : 'Viewings')}{me.tenant.productSlug === 'restaurant' && entities.find((e) => e.key === 'order')?.canCreate && nav('/app/pos', locale === 'ar' ? 'نقطة البيع' : 'POS')}
          <h4>{t('products')}</h4>{entities.map((e) => nav(`/app/e/${e.key}`, label(e)))}
          <h4>{t('settings')}</h4>
          {nav('/app/billing', t('billing'))}{ctx.can('roles.manage') && nav('/app/roles', locale === 'ar' ? 'الأدوار والصلاحيات' : 'Roles & permissions')}{ctx.can('tenant.settings') && nav('/app/settings', t('settings'))}{nav('/app/site', t('website'))}{nav('/app/domains', t('domains'))}{ctx.can('tenant.settings') && nav('/app/outbox', locale === 'ar' ? 'الرسائل الصادرة' : 'Outbox')}{ctx.can('employees.read') && nav('/app/team', t('team'))}{ctx.can('audit.read') && nav('/app/audit', t('audit'))}
        </aside>
        <div style={{ minWidth: 0 }}>
          <div className="topbar">
            <button className="btn sm menu-btn" onClick={() => setOpen((o) => !o)} aria-label="Menu">☰</button>
            <GlobalSearch /><span className="grow" />
            <Link className="btn sm" href="/app/notifications" aria-label={unread > 0 ? `${t('notifications')} ${unread}` : t('notifications')}>🔔{unread > 0 && <span className="badge info">{unread}</span>}</Link>
            <LocaleSwitch /><ThemeToggle /><button className="btn sm" onClick={logout}>{t('logout')}</button>
          </div>
          {anns.map((a) => <div key={a.id} className={`alert ${a.level === 'critical' ? 'error' : a.level === 'warning' ? 'warn' : 'info'}`} style={{ margin: '12px 24px 0' }} role="status"><b>{locale === 'ar' ? a.titleAr : a.titleEn}</b>{(locale === 'ar' ? a.bodyAr : a.bodyEn) && <span> — {locale === 'ar' ? a.bodyAr : a.bodyEn}</span>}</div>)}{access && access.access !== 'full' && <div className="alert warn" style={{ margin: '12px 24px 0' }} role="status">{t('readOnlyNote')} <Link href="/app/billing">{t('billing')}</Link></div>}
          <main className="main-pane" id="main" tabIndex={-1}>{children}</main>
        </div>
      </div>
    </AppCtx.Provider>
  );
}
function titleOf(def: EntityMeta, r: Rec): string {
  const base = def.titleField === '$code' ? r.code : r.data[def.titleField];
  return [base ?? r.id.slice(0, 8), def.titleField !== '$code' && r.code ? `· ${r.code}` : ''].filter(Boolean).join(' ');
}

function GlobalSearch() {
  const { t } = useI18n(); const app = useApp(); const router = useRouter(); const [q, setQ] = useState(''); const [rows, setRows] = useState<any[]>([]); const [open, setOpen] = useState(false);
  useEffect(() => { if (q.trim().length < 2) { setRows([]); return; } const h = setTimeout(() => { api<any[]>(`/search?q=${encodeURIComponent(q)}&pageSize=8`).then((r) => { setRows(r.data); setOpen(true); }).catch(() => setRows([])); }, 250); return () => clearTimeout(h); }, [q]);
  return (
    <div className="searchbox" role="search">
      <input type="search" value={q} placeholder={t('searchPlaceholder')} aria-label={t('search')} onChange={(e) => setQ(e.target.value)} onFocus={() => rows.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) router.push(`/app/search?q=${encodeURIComponent(q)}`); if (e.key === 'Escape') { setOpen(false); setQ(''); } }} />
      {open && <div className="dropdown">{rows.length ? rows.map((r) => <Link key={r.entityType + r.entityId} href={`/app/e/${r.entityType}/${r.entityId}`}><span>{r.title}</span><span className="muted small">{app.entity(r.entityType) ? app.label(app.entity(r.entityType)!) : r.entityType}</span></Link>) : <div className="muted" style={{ padding: 12 }}>{t('noResults')}</div>}</div>}
    </div>
  );
}
