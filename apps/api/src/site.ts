import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import dns from 'node:dns/promises';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { auditLogs, domains, tenantSites, tenants, type Db } from '@codela/db';
import { PRODUCT_THEMES, type ProductSlug } from '@codela/design';
import { DEFAULT_HOURS, defaultSections, type SiteLocale } from '@codela/shared';
import { HttpError, badRequest, conflict, notFound } from './errors';
import { getEntitlements } from './entitlements';
import { requirePermission } from './auth';

export type ResolveTxt = (host: string) => Promise<string[]>;
export const defaultResolveTxt: ResolveTxt = async (host) => {
  try { return (await dns.resolveTxt(host)).map((parts) => parts.join('')); } catch { return []; }
};

export const TEMPLATES: Record<string, { premium: boolean }> = {
  classic: { premium: false }, modern: { premium: false }, 'premium-clinic': { premium: true }, 'premium-store': { premium: true },
};
const SECTION_TYPES = ['hero', 'about', 'services', 'team', 'gallery', 'testimonials', 'contact', 'faq', 'pricing', 'products', 'map', 'hours', 'booking'] as const;

const httpsUrl = z.string().url().max(500).refine((u) => u.startsWith('https://'), 'must be an https URL');
// An uploaded logo is referenced by its public file path (the files router only serves image files with visibility=public there).
const logoRef = z.union([httpsUrl, z.string().regex(/^\/api\/v1\/public\/files\/[0-9a-f-]{36}$/)]);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be #rrggbb');
const imgRef = z.union([httpsUrl, z.string().regex(/^\/api\/v1\/public\/files\/[0-9a-f-]{36}$/, 'must be an uploaded image or an https URL')]);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
// One item shape serves the owner-editable lists: highlights, services, team members (title = name, text = job title, photoUrl), gallery images, FAQ, testimonials.
const contentItem = z.object({ title: z.string().trim().max(200).default(''), text: z.string().max(1500).optional(), photoUrl: imgRef.optional() }).strict();
const sectionContent = z.object({ title: z.string().max(200).optional(), text: z.string().max(3000).optional(), items: z.array(contentItem).max(40).optional() }).passthrough();
export const seoSchema = z.object({ title: z.string().trim().max(70).optional(), description: z.string().trim().max(200).optional(), ogImage: imgRef.nullish(), keywords: z.string().trim().max(200).optional(), noindex: z.boolean().optional() }).strict();
export const hoursSchema = z.object({
  weekly: z.array(z.object({ day: z.number().int().min(0).max(6), closed: z.boolean().default(false), open: hhmm.default('09:00'), close: hhmm.default('17:00') })
    .refine((d) => d.closed || d.open < d.close, 'closing time must be after opening time')).max(7)
    .refine((w) => new Set(w.map((d) => d.day)).size === w.length, 'one entry per weekday'),
  holidays: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'), label: z.string().trim().max(80).default('') })).max(40),
}).strict();
export const themeSchema = z.object({ font: z.enum(['default', 'serif', 'rounded', 'mono']).optional(), layout: z.enum(['standard', 'wide', 'compact']).optional(), header: z.enum(['solid', 'transparent', 'centered']).optional(), footer: z.enum(['simple', 'columns']).optional() }).strict();
/** Extra pages of the public site, each with its own SEO-friendly URL (/sites/<tenant>/<slug>). The slug is unique per site and may not shadow a built-in route. */
export const RESERVED_PAGE_SLUGS = ['portal', 'properties', 'doctors', 'api', 'app', 'admin', 'login', 'register', 'pricing', 'contact', 'recover', 'products', 'sites', 'driver', '_next', 'p', 'sitemap', 'robots'];
export const pageSchema = z.object({
  slug: z.string().trim().toLowerCase().min(2).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase letters, digits and single hyphens only').refine((v) => !RESERVED_PAGE_SLUGS.includes(v), 'this address is reserved'),
  title: z.string().trim().min(1).max(120), enabled: z.boolean().default(true),
  seo: z.object({ title: z.string().trim().max(70).optional(), description: z.string().trim().max(200).optional(), noindex: z.boolean().optional() }).strict().default({}),
  sections: z.array(z.object({ type: z.enum(SECTION_TYPES), enabled: z.boolean(), content: sectionContent })).max(20),
}).strict();
export const siteSchema = z.object({
  templateKey: z.string().refine((k) => k in TEMPLATES, 'unknown template'),
  brand: z.object({
    name: z.string().trim().min(1).max(120), primaryColor: color, secondaryColor: color,
    logoUrl: logoRef.nullish(), faviconUrl: httpsUrl.nullish(), description: z.string().max(1000).default(''),
    phone: z.string().max(30).nullish(), email: z.string().email().nullish(), address: z.string().max(300).nullish(),
    socials: z.record(z.string().max(30), httpsUrl).refine((o) => Object.keys(o).length <= 10).default({}),
  }),
  sections: z.array(z.object({ type: z.enum(SECTION_TYPES), enabled: z.boolean(), content: sectionContent })).max(30),
  seo: seoSchema.optional(), hours: hoursSchema.optional(), theme: themeSchema.optional(), pages: z.array(pageSchema).max(12).optional(),
}).superRefine((v, ctx) => { const seen = new Set<string>(); (v.pages ?? []).forEach((pg, i) => { if (seen.has(pg.slug)) ctx.addIssue({ code: 'custom', path: ['pages', i, 'slug'], message: 'duplicate slug: every page needs its own address' }); seen.add(pg.slug); }); })
  .refine((v) => JSON.stringify(v).length < 200_000, 'site content too large');

const HOST = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function siteRouters(db: Db, o: { rootDomain: string; resolveTxt: ResolveTxt }) {
  const root = o.rootDomain.toLowerCase();
  const authed = Router(); const pub = Router();

  const defaultDraft = (tenantId: string) => {
    const t = db.select().from(tenants).where(eq(tenants.id, tenantId)).get()!;
    const th = PRODUCT_THEMES[t.productSlug as ProductSlug];
    // a new website starts with real "who we are / what we do / our services" text for the product (in the business language), not empty boxes
    return { brand: { name: t.name, primaryColor: th?.primary ?? '#1d4ed8', secondaryColor: th?.accent ?? '#c2410c', description: '', socials: {} },
      sections: defaultSections(t.productSlug, (t.locale === 'en' ? 'en' : 'ar') as SiteLocale, t.name), seo: {}, hours: DEFAULT_HOURS, theme: {} };
  };
  const ensureSite = (tenantId: string) => {
    let row = db.select().from(tenantSites).where(eq(tenantSites.tenantId, tenantId)).get();
    if (!row) row = db.insert(tenantSites).values({ tenantId, draft: defaultDraft(tenantId) }).returning().get();
    return row;
  };

  authed.get('/tenant/site', requirePermission('tenant.settings'), (req, res) => {
    const r = ensureSite(req.auth!.tenantId);
    res.json({ data: { templateKey: r.templateKey, draft: r.draft, publishedAt: r.publishedAt } });
  });
  authed.put('/tenant/site', requirePermission('tenant.settings'), (req, res, next) => {
    try {
      const b = siteSchema.parse(req.body); const tenantId = req.auth!.tenantId;
      if (TEMPLATES[b.templateKey].premium && getEntitlements(db, tenantId).limits.premiumTemplates !== true)
        throw new HttpError(403, 'PLAN_LIMIT_EXCEEDED', 'This template requires the Premium templates add-on');
      const prev = ensureSite(tenantId).draft as { seo?: unknown; hours?: unknown; theme?: unknown; pages?: unknown };
      // seo / hours / theme that a client does not send keep their stored value (older clients never overwrite them with nothing)
      const draft = { brand: b.brand, sections: b.sections, seo: b.seo ?? prev.seo ?? {}, hours: b.hours ?? prev.hours ?? DEFAULT_HOURS, theme: b.theme ?? prev.theme ?? {}, pages: b.pages ?? prev.pages ?? [] };
      db.update(tenantSites).set({ templateKey: b.templateKey, draft }).where(eq(tenantSites.tenantId, tenantId)).run();
      res.json({ data: { templateKey: b.templateKey, draft } });
    } catch (e) { next(e); }
  });
  authed.post('/tenant/site/publish', requirePermission('tenant.settings'), (req, res) => {
    const tenantId = req.auth!.tenantId; const r = ensureSite(tenantId); const now = new Date().toISOString();
    db.update(tenantSites).set({ published: { templateKey: r.templateKey, ...r.draft }, publishedAt: now }).where(eq(tenantSites.tenantId, tenantId)).run();
    db.insert(auditLogs).values({ action: 'site.published', tenantId, actorId: req.auth!.userId }).run();
    res.json({ data: { publishedAt: now } });
  });

  // ---- domains ----
  const view = (d: typeof domains.$inferSelect) => ({ id: d.id, hostname: d.hostname, status: d.status, isPrimary: d.isPrimary, sslStatus: d.sslStatus, lastCheckedAt: d.lastCheckedAt,
    dns: { type: 'TXT', txtName: `_codela-verify.${d.hostname}`, txtValue: d.verifyToken,
      instructions: `Add a TXT record named _codela-verify.${d.hostname} with the value shown, then press Verify. Also point the domain (CNAME/A) to your Codela address.` } });
  authed.get('/tenant/domains', requirePermission('domains.manage'), (req, res) =>
    res.json({ data: db.select().from(domains).where(eq(domains.tenantId, req.auth!.tenantId)).all().map(view) }));
  authed.post('/tenant/domains', requirePermission('domains.manage'), (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const { hostname } = z.object({ hostname: z.string().trim().toLowerCase().regex(HOST, 'invalid hostname')
        .refine((h) => h !== root && !h.endsWith(`.${root}`), 'platform domains cannot be added') }).parse(req.body);
      if (getEntitlements(db, tenantId).limits.customDomain !== true) throw new HttpError(403, 'PLAN_LIMIT_EXCEEDED', 'Custom domains are not included in your plan');
      if (db.select().from(domains).where(eq(domains.tenantId, tenantId)).all().length >= 5) throw new HttpError(403, 'PLAN_LIMIT_EXCEEDED', 'Domain limit reached');
      const row = db.insert(domains).values({ tenantId, hostname, verifyToken: `codela-${randomBytes(16).toString('hex')}` }).returning().get();
      db.insert(auditLogs).values({ action: 'domain.added', tenantId, actorId: req.auth!.userId, entity: 'domain', entityId: row.id }).run();
      res.status(201).json({ data: view(row) });
    } catch (e) { next(/UNIQUE/.test(String((e as Error)?.message)) ? conflict('This domain is already registered') : e); }
  });
  const own = (req: { auth?: { tenantId: string }; params: Record<string, string | string[]> }) =>
    db.select().from(domains).where(and(eq(domains.id, String(req.params.id)), eq(domains.tenantId, req.auth!.tenantId))).get();
  authed.post('/tenant/domains/:id/verify', requirePermission('domains.manage'), async (req, res, next) => {
    try {
      const d = own(req); if (!d) throw notFound('Domain not found');
      const values = (await o.resolveTxt(`_codela-verify.${d.hostname}`)).map((v) => v.trim().replace(/^"|"$/g, ''));
      const ok = values.includes(d.verifyToken); const now = new Date().toISOString();
      const upd = ok ? { status: 'verified', verifiedAt: now, lastCheckedAt: now, sslStatus: 'pending_provisioning' } : { lastCheckedAt: now };
      db.update(domains).set(upd).where(eq(domains.id, d.id)).run();
      if (ok) db.insert(auditLogs).values({ action: 'domain.verified', tenantId: d.tenantId, actorId: req.auth!.userId, entity: 'domain', entityId: d.id }).run();
      res.json({ data: { ...view(db.select().from(domains).where(eq(domains.id, d.id)).get()!), verified: ok } });
    } catch (e) { next(e); }
  });
  authed.post('/tenant/domains/:id/primary', requirePermission('domains.manage'), (req, res, next) => {
    try {
      const d = own(req); if (!d) throw notFound('Domain not found');
      if (d.status !== 'verified') throw conflict('Only verified domains can be primary');
      db.transaction((tx) => {
        tx.update(domains).set({ isPrimary: false }).where(eq(domains.tenantId, d.tenantId)).run();
        tx.update(domains).set({ isPrimary: true }).where(eq(domains.id, d.id)).run();
      });
      res.json({ data: { ok: true } });
    } catch (e) { next(e); }
  });
  authed.delete('/tenant/domains/:id', requirePermission('domains.manage'), (req, res, next) => {
    const d = own(req); if (!d) return next(notFound('Domain not found'));
    db.delete(domains).where(eq(domains.id, d.id)).run();
    db.insert(auditLogs).values({ action: 'domain.removed', tenantId: d.tenantId, actorId: req.auth!.userId, entity: 'domain', entityId: d.id }).run();
    res.json({ data: { ok: true } });
  });

  authed.get('/tenant/audit-logs', requirePermission('audit.read'), (req, res, next) => {
    try {
      const q = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
      const rows = db.select().from(auditLogs).where(eq(auditLogs.tenantId, req.auth!.tenantId)).orderBy(desc(auditLogs.createdAt))
        .limit(q.pageSize).offset((q.page - 1) * q.pageSize).all();
      res.json({ data: rows, meta: { page: q.page, pageSize: q.pageSize } });
    } catch (e) { next(e); }
  });

  // ---- public site resolution: verified custom domain or <slug>.<rootDomain> only ----
  const resolveTenant = (host: string) => {
    let tenantId: string | undefined;
    if (host.endsWith(`.${root}`)) {
      const slug = host.slice(0, -(root.length + 1));
      if (!slug.includes('.')) tenantId = db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).get()?.id;
    } else {
      tenantId = db.select({ id: domains.tenantId }).from(domains).where(and(eq(domains.hostname, host), eq(domains.status, 'verified'))).get()?.id;
    }
    const t = tenantId ? db.select().from(tenants).where(eq(tenants.id, tenantId)).get() : undefined;
    return t && t.status === 'active' ? t : undefined;
  };
  pub.get('/site', (req, res, next) => {
    try {
      const t = resolveTenant(req.hostname.toLowerCase());
      if (!t) throw notFound('Site not found');
      const tenantId = t.id;
      const s = db.select().from(tenantSites).where(eq(tenantSites.tenantId, tenantId)).get();
      if (!s?.published) throw notFound('Site not found');
      const p = s.published as { templateKey: string; brand: unknown; sections: unknown; seo?: unknown; hours?: unknown; theme?: unknown; pages?: { enabled?: boolean }[] };
      res.json({ data: { templateKey: p.templateKey, brand: p.brand, sections: p.sections, seo: p.seo ?? {}, hours: p.hours ?? null, theme: p.theme ?? {}, pages: (p.pages ?? []).filter((x) => x.enabled !== false), locale: t.locale, currency: t.currency, productSlug: t.productSlug, publishedAt: s.publishedAt } });
    } catch (e) { next(e); }
  });
  return { authed, pub, resolveTenant };
}
export { badRequest };
