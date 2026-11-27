'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { themeToCssVars, type ProductSlug } from '@codela/design';
import { api, ApiError } from '@/lib/api';
import { fmtMoney, type Locale } from '@/lib/i18n';
import { BOARDS } from '@/lib/boards';
import { fontsHref } from '@/lib/fonts';
import { useI18n, useTheme } from '../Providers';
import { Icon, PRODUCT_ICON } from '../Icon';

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
  const { locale, t } = useI18n(); const router = useRouter(); const path = usePathname(); const search = useSearchParams().toString();
  const [state, setState] = useState<{ me: Me; entities: EntityMeta[] } | null>(null); const [err, setErr] = useState<ApiError | null>(null); const [open, setOpen] = useState(false); const [navQ, setNavQ] = useState(''); const [navCollapsed, setNavCollapsed] = useState(false);
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

  useEffect(() => { if (!open) return; const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false); document.addEventListener('keydown', esc); return () => document.removeEventListener('keydown', esc); }, [open]);
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
  const P = me.tenant.productSlug; const L = (ar: string, en: string) => (locale === 'ar' ? ar : en); const has = (k: string) => entities.some((e) => e.key === k);
  /** Product workspace screens (boards, POS, cockpit…): the same entries and permission rules as before, now as data. */
  const work: NavItem[] = [
    { href: '/app', text: t('dashboard'), icon: 'home', exact: true },
    { show: !!BOARDS[P] && has(BOARDS[P]?.entity), href: '/app/board', text: BOARDS[P]?.title[locale] ?? '', icon: 'kanban' },
    { show: P === 'realestate' && ctx.can('leads.read'), href: '/app/lead-performance', text: L('أداء العملاء المحتملين', 'Lead performance'), icon: 'chart' },
    { show: P === 'business' && ctx.can('quotations.read'), href: '/app/quotations', text: L('عروض الأسعار', 'Quotations'), icon: 'file' },
    { show: P === 'business' && ctx.can('stock.read'), href: '/app/stock', text: L('المخزون حسب المخزن', 'Stock by warehouse'), icon: 'box' },
    { show: P === 'fleet' && ctx.can('collections.read'), href: '/app/cash', text: L('تحصيلات المناديب', 'Driver cash'), icon: 'cash' },
    { show: P === 'automotive' && ctx.can('workOrders.read'), href: '/app/workorders', text: L('أوامر الشغل', 'Work orders'), icon: 'wrench' },
    { show: P === 'automotive' && ctx.can('warranties.read'), href: '/app/warranties', text: L('الضمان', 'Warranties'), icon: 'shield' },
    { show: P === 'construction' && ctx.can('estimates.read'), href: '/app/estimates', text: L('المقايسات والمستخلصات', 'Estimates & claims'), icon: 'clipboard' },
    { show: P === 'realestate' && ctx.can('commissions.read'), href: '/app/commissions', text: L('صرف العمولات', 'Commission payouts'), icon: 'cash' },
    { show: P === 'realestate' && (ctx.can('sales.read') || ctx.can('rentals.read')), href: '/app/contracts', text: L('العقود', 'Contracts'), icon: 'file' },
    { show: P === 'learning' && ctx.can('courses.read'), href: '/app/course-builder', text: L('بناء الكورس', 'Course builder'), icon: 'layers' },
    ...Object.entries(BOARDS).filter(([k, c]) => k.startsWith(`${P}:`) && has(c.entity)).map(([k, c]) => ({ href: `/app/board?b=${k.split(':')[1]}`, text: c.title[locale], icon: 'kanban' })),
    { show: P === 'medical' && ctx.can('dispensing.read'), href: '/app/pharmacy', text: L('الصيدلية', 'Pharmacy'), icon: 'pill' },
    { show: P === 'medical' && ctx.can('labs.read'), href: '/app/lab', text: L('المعمل', 'Laboratory'), icon: 'flask' },
    { show: P === 'medical' && ctx.can('imaging.read'), href: '/app/radiology', text: L('الأشعة', 'Radiology'), icon: 'scan' },
    { show: ['booking', 'medical'].includes(P), href: '/app/calendar', text: L('التقويم', 'Calendar'), icon: 'calendar' },
    { show: has('paymentRequest'), href: '/app/payments', text: L('مدفوعات العملاء', 'Customer payments'), icon: 'card' },
    { show: P === 'business' && has('attendance'), href: '/app/attendance', text: L('الحضور والانصراف', 'Attendance'), icon: 'clock' },
    { show: P === 'business' && has('quotation'), href: '/app/board?b=quotations', text: L('عروض الأسعار', 'Quotations'), icon: 'kanban' },
    { show: P === 'business' && has('jobApplication'), href: '/app/board?b=applications', text: L('طلبات التوظيف', 'Applications'), icon: 'users' },
    { show: P === 'construction', href: '/app/projects', text: L('لوحة المشاريع', 'Project cockpit'), icon: 'grid' },
    { show: P === 'learning', href: '/app/board?b=reviews', text: L('مراجعة التقييمات', 'Review moderation'), icon: 'star' },
    { show: P === 'fleet', href: '/app/proofs', text: L('إثباتات التسليم', 'Delivery proofs'), icon: 'checkCircle' },
    { show: P === 'fleet' && ctx.can('employees.manage'), href: '/app/driver-accounts', text: L('حسابات المناديب', 'Driver logins'), icon: 'key' },
    { show: P === 'automotive', href: '/app/board?b=requests', text: L('طلبات الحجز والأسعار', 'Booking & quotes'), icon: 'inbox' },
    { show: P === 'realestate', href: '/app/board?b=leads', text: L('العملاء المحتملون', 'Leads pipeline'), icon: 'kanban' },
    { show: P === 'realestate', href: '/app/board?b=viewings', text: L('المعاينات', 'Viewings'), icon: 'pin' },
    { show: P === 'restaurant' && !!entities.find((e) => e.key === 'order')?.canCreate, href: '/app/pos', text: L('نقطة البيع', 'POS'), icon: 'receipt' },
  ];
  const admin: NavItem[] = [
    { href: '/app/billing', text: t('billing'), icon: 'card' },
    { show: ctx.can('roles.manage'), href: '/app/roles', text: L('الأدوار والصلاحيات', 'Roles & permissions'), icon: 'shield' },
    { show: ctx.can('tenant.settings'), href: '/app/settings', text: t('settings'), icon: 'settings' },
    { href: '/app/site', text: t('website'), icon: 'globe' },
    { href: '/app/domains', text: t('domains'), icon: 'link' },
    { show: ctx.can('tenant.settings'), href: '/app/outbox', text: L('الرسائل الصادرة', 'Outbox'), icon: 'mail' },
    { show: ctx.can('employees.read'), href: '/app/team', text: t('team'), icon: 'users' },
    { show: ctx.can('audit.read'), href: '/app/audit', text: t('audit'), icon: 'activity' },
  ];
  const full = path + (search ? `?${search}` : '');
  const isCur = (n: NavItem) => (n.href.includes('?') ? full === n.href : n.exact ? path === n.href : (path === n.href || path.startsWith(n.href + '/')) && !(n.href === '/app/board' && full.includes('?b=')));
  const nav = (n: NavItem) => n.show === false ? null : <Link key={n.href} className="item" href={n.href} aria-current={isCur(n) ? 'page' : undefined} onClick={() => setOpen(false)}><Icon name={n.icon} size={17} /><span>{n.text}</span></Link>;
  const recs = entities.filter((e) => !navQ || label(e).toLowerCase().includes(navQ.toLowerCase()));
  async function logout() { await api('/auth/logout', { method: 'POST' }).catch(() => {}); router.replace('/login'); }
  return (
    <AppCtx.Provider value={ctx}>
      <style>{themeToCssVars(me.tenant.productSlug as ProductSlug)}</style>
      <link rel="stylesheet" href={fontsHref(me.tenant.productSlug)} />
      <div className="shell" data-product={me.tenant.productSlug}>
        <aside id="app-nav" className={`sidebar${open ? ' open' : ''}`} aria-label={L('التنقل', 'Navigation')}>
          <div className="brand"><span className="dot"><Icon name={PRODUCT_ICON[P] ?? 'grid'} size={18} /></span><span className="t"><span>{me.tenant.name}</span><small>{productName(P, locale)}</small></span></div>
          <nav aria-label={L('مساحة العمل', 'Workspace')} style={{ display: 'contents' }}>{work.map(nav)}</nav>
          <details open={!navCollapsed} onToggle={(e) => setNavCollapsed(!(e.currentTarget as HTMLDetailsElement).open)}>
            <summary>{L('السجلات', 'Records')}<span className="badge" style={{ background: 'var(--sb-hover)', color: 'inherit' }}>{entities.length}</span><Icon name="chevronDown" size={14} /></summary>
            {entities.length > 10 && <input type="search" className="nav-filter" value={navQ} onChange={(e) => setNavQ(e.target.value)} placeholder={L('تصفية القائمة…', 'Filter…')} aria-label={L('تصفية السجلات', 'Filter records')} />}
            <nav aria-label={L('السجلات', 'Records')}>{recs.map((e) => nav({ href: `/app/e/${e.key}`, text: label(e), icon: entityIcon(e.key) }))}</nav>
          </details>
          <div className="nav-label">{t('settings')}</div>
          <nav aria-label={t('settings')}>{admin.map(nav)}</nav>
        </aside>
        <div className={`sb-backdrop${open ? ' open' : ''}`} onClick={() => setOpen(false)} aria-hidden="true" />
        <div style={{ minWidth: 0 }}>
          <header className="topbar">
            <button className="icon-btn menu-btn" onClick={() => setOpen((o) => !o)} aria-label={L('القائمة', 'Menu')} aria-expanded={open} aria-controls="app-nav"><Icon name="menu" size={20} /></button>
            <GlobalSearch /><span className="grow" />
            <Link className="icon-btn" href="/app/notifications" aria-label={unread > 0 ? `${t('notifications')} ${unread}` : t('notifications')} title={t('notifications')}><Icon name="bell" size={19} />{unread > 0 && <span className="count">{unread > 99 ? '99+' : unread}</span>}</Link>
            <AccountMenu me={me} onLogout={logout} />
          </header>
          {anns.map((a) => <div key={a.id} className={`alert shell-banner ${a.level === 'critical' ? 'error' : a.level === 'warning' ? 'warn' : 'info'}`} role="status"><b>{locale === 'ar' ? a.titleAr : a.titleEn}</b>{(locale === 'ar' ? a.bodyAr : a.bodyEn) && <span> — {locale === 'ar' ? a.bodyAr : a.bodyEn}</span>}</div>)}{access && access.access !== 'full' && <div className="alert warn shell-banner" role="status">{t('readOnlyNote')} <Link href="/app/billing">{t('billing')}</Link></div>}
          <main className="main-pane" id="main" tabIndex={-1}>{children}</main>
        </div>
      </div>
    </AppCtx.Provider>
  );
}
interface NavItem { href: string; text: string; icon: string; exact?: boolean; show?: boolean }
const PRODUCT_NAMES: Record<string, [string, string]> = { medical: ['كوديلا ميد', 'Codela Med'], realestate: ['كوديلا عقارات', 'Codela Real Estate'], ecommerce: ['كوديلا متاجر', 'Codela E-Commerce'], restaurant: ['كوديلا مطاعم', 'Codela Restaurant'], automotive: ['كوديلا سيارات', 'Codela Automotive'], learning: ['كوديلا تعليم', 'Codela Learning'], construction: ['كوديلا مقاولات', 'Codela Construction'], booking: ['كوديلا حجوزات', 'Codela Booking'], fleet: ['كوديلا أسطول وتوصيل', 'Codela Fleet & Delivery'], business: ['كوديلا أعمال', 'Codela Business'] };
const productName = (slug: string, locale: Locale) => (PRODUCT_NAMES[slug] ?? ['Codela', 'Codela'])[locale === 'ar' ? 0 : 1];
/** Icon for a record type, from its key (falls back to a neutral list icon). */
function entityIcon(k: string): string {
  const rules: [RegExp, string][] = [[/patient|customer|student|client|guest|lead|contact|enrol/i, 'users'], [/doctor|instructor|technician|staff|employee|broker|driver|agent/i, 'user'],
    [/appointment|reservation|booking|schedule|session|viewing|shift|attendance/i, 'calendar'], [/invoice|receipt|dispense/i, 'receipt'], [/payment|payout|commission|collection|expense|cash/i, 'card'],
    [/product|item|part|ingredient|medication|stock|movement|warehouse|transfer|ledger/i, 'box'], [/order|purchase|cart/i, 'bag'], [/vehicle|car|make/i, 'car'], [/shipment|delivery|route|trip|rate/i, 'truck'],
    [/property|unit|project|branch|site|building/i, 'building'], [/course|lesson|exam|assignment|certificate|material/i, 'graduation'], [/lab|test/i, 'flask'], [/imaging|scan|radiology/i, 'scan'],
    [/prescription|medicalRecord|history|record|note|contract|quotation|estimate|document|article/i, 'file'], [/review|rating|faq|inquiry|request|ticket|message|application/i, 'inbox'],
    [/service|category|specialty|menu|recipe|promotion|offer|coupon|tag/i, 'tag'], [/table/i, 'utensils'], [/supplier|vendor/i, 'briefcase'], [/work|task|warranty/i, 'wrench']];
  return rules.find(([re]) => re.test(k))?.[1] ?? 'list';
}
function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase() || '?'; }
function AccountMenu({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const { t, locale, setLocale } = useI18n(); const [open, setOpen] = useState(false); const [theme, flipTheme] = useTheme(); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); (ref.current?.querySelector('.user-btn') as HTMLElement | null)?.focus(); } };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc); return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); }; }, [open]);
  const L = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  return (
    <div className="menu" ref={ref}>
      <button type="button" className="user-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label={L('حسابي', 'Account')}><span className="avatar" aria-hidden="true">{initials(me.user.name)}</span><span className="name">{me.user.name}</span><Icon name="chevronDown" size={14} /></button>
      {open && <div className="menu-pop" role="menu">
        <div className="menu-head"><b>{me.user.name}</b><span>{me.user.email}</span><span className="badge info" style={{ justifySelf: 'start', marginTop: 6 }}>{me.role}</span></div>
        <Link role="menuitem" href="/app/settings" onClick={() => setOpen(false)}><Icon name="settings" size={16} />{L('إعدادات الحساب', 'Account settings')}</Link>
        <Link role="menuitem" href="/app/billing" onClick={() => setOpen(false)}><Icon name="card" size={16} />{t('billing')}</Link>
        <button role="menuitem" type="button" onClick={flipTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />{theme === 'dark' ? L('الوضع الفاتح', 'Light mode') : L('الوضع الداكن', 'Dark mode')}</button>
        <button role="menuitem" type="button" lang={locale === 'ar' ? 'en' : 'ar'} onClick={() => { setLocale(locale === 'ar' ? 'en' : 'ar'); setOpen(false); }}><Icon name="languages" size={16} />{t('language')}</button>
        <hr />
        <button role="menuitem" type="button" onClick={onLogout}><Icon name="logout" size={16} className="flip" />{t('logout')}</button>
      </div>}
    </div>
  );
}
function titleOf(def: EntityMeta, r: Rec): string {
  const base = def.titleField === '$code' ? r.code : r.data[def.titleField];
  return [base ?? r.id.slice(0, 8), def.titleField !== '$code' && r.code ? `· ${r.code}` : ''].filter(Boolean).join(' ');
}

function GlobalSearch() {
  const { t, locale } = useI18n(); const app = useApp(); const router = useRouter(); const [q, setQ] = useState(''); const [rows, setRows] = useState<any[]>([]); const [open, setOpen] = useState(false); const [act, setAct] = useState(-1); const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (q.trim().length < 2) { setRows([]); return; } const h = setTimeout(() => { api<any[]>(`/search?q=${encodeURIComponent(q)}&pageSize=8`).then((r) => { setRows(r.data); setOpen(true); setAct(-1); }).catch(() => setRows([])); }, 220); return () => clearTimeout(h); }, [q]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.current?.focus(); input.current?.select(); } }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, []);
  const go = (href: string) => { setOpen(false); setQ(''); router.push(href); };
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <div className="searchbox" role="search">
      <Icon name="search" size={16} />
      <input ref={input} type="search" value={q} placeholder={t('searchPlaceholder')} aria-label={t('search')} role="combobox" aria-expanded={open} aria-controls="gs-results" aria-autocomplete="list" aria-activedescendant={act >= 0 ? `gs-${act}` : undefined}
        onChange={(e) => setQ(e.target.value)} onFocus={() => rows.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && rows.length) { e.preventDefault(); setOpen(true); setAct((a) => (a + 1) % rows.length); }
          else if (e.key === 'ArrowUp' && rows.length) { e.preventDefault(); setAct((a) => (a <= 0 ? rows.length - 1 : a - 1)); }
          else if (e.key === 'Enter' && q.trim()) { e.preventDefault(); const r = rows[act]; go(r ? `/app/e/${r.entityType}/${r.entityId}` : `/app/search?q=${encodeURIComponent(q)}`); }
          else if (e.key === 'Escape') { setOpen(false); setQ(''); } }} />
      {!q && <kbd aria-hidden="true">{mac ? '⌘K' : 'Ctrl K'}</kbd>}
      {open && <div className="dropdown" id="gs-results" role="listbox" aria-label={t('search')}>{rows.length ? <>{rows.map((r, i) => <Link key={r.entityType + r.entityId} id={`gs-${i}`} role="option" aria-selected={i === act} style={i === act ? { background: 'var(--surface-2)' } : undefined} href={`/app/e/${r.entityType}/${r.entityId}`} onClick={() => setOpen(false)}><span className="row" style={{ gap: 10, flexWrap: 'nowrap', minWidth: 0 }}><Icon name={entityIcon(r.entityType)} size={16} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</span></span><span className="muted small">{app.entity(r.entityType) ? app.label(app.entity(r.entityType)!) : r.entityType}</span></Link>)}
        <Link href={`/app/search?q=${encodeURIComponent(q)}`} onClick={() => setOpen(false)} className="small" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>{locale === 'ar' ? 'عرض كل النتائج' : 'See all results'}</Link></>
        : <div className="muted small" style={{ padding: 12 }}>{t('noResults')}</div>}</div>}
    </div>
  );
}
