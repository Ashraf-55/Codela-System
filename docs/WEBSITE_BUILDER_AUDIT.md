# Website builder audit

Date: 2026-11-24 · Scope: dashboard `/app/site` → `PUT /tenant/site` → publish → public `/sites/<slug>` (and custom domains).
Evidence: `apps/api/test/site-builder.test.ts` (API, 5 tests) and a real server-rendered check of all 10 products (see "Verified" below). **No browser run** (none available in the authoring environment).

| Requirement | Before | Now | Where |
|---|---|---|---|
| Business info (name, description, phone, e-mail, address) | ✅ | ✅ | brand |
| **Who we are / what we do / services text** | ❌ empty `about`/`services` boxes | ✅ every product starts with real ar/en copy (about + 4 highlights + 4 services + hours); owner edits it | `packages/shared/src/site-defaults.ts`, `site.ts` default draft; render fallback for old sites |
| Team members (name / role / photo) | ⚠️ free text | ✅ structured items with photo upload | `team` section items |
| Gallery (images) | ❌ | ✅ upload (new public `site` purpose, 5 MB, images only) | `gallery` section |
| Services / FAQ / testimonials / pricing lists | ❌ | ✅ item editor (max 40, validated) | section items |
| Working hours + holidays | ❌ | ✅ weekly table + holidays, validated, rendered on site and footer | `hours` |
| Social links | ⚠️ API only | ✅ editor + footer links (https only, `rel=noopener`) | brand.socials |
| SEO: title, meta description, keywords, OG image, noindex | ❌ | ✅ real `<title>`, meta, Open Graph, Twitter card, robots | `seo`, `generateMetadata` |
| SEO "slug" | – | Site address is the tenant slug / verified custom domain (page anchors are fixed); a per-page slug was **not** added | – |
| Typography / layout / header / footer | ❌ | ✅ 4 font, 3 layout, 3 header, 2 footer options | `theme` |
| Colors, logo | ✅ | ✅ | brand |
| Draft vs published | ✅ | ✅ unchanged; tests prove later drafts stay hidden until republish | |
| Older clients not wiping new fields | – | ✅ omitted `seo/hours/theme` keep their stored value | test |

## Security notes
- All URLs (`photoUrl`, `ogImage`, socials) must be `https://` or an uploaded `/api/v1/public/files/<uuid>`; `javascript:` and local paths are rejected (tested). Items are `strict` objects; unknown keys are rejected.
- Text is rendered as React text (escaped); nothing is injected as HTML. Control characters are stripped from template variables.
- Uploading a site image needs `tenant.settings` (employees get 403, tested); files are tenant-owned and public only for images.

## Verified
- Test-suite: each of the 10 products' new draft has about/services/hours; nothing public before publish; publish exposes them; invalid input → 400 (15 cases).
- **Real SSR smoke** (API + `next start`, 10 tenants registered and published over HTTP): every public page returned 200 and contained `#sec-about`, `#sec-services`, `#sec-hours`, a weekly hours table and the business name.

## Not covered / remaining
- Browser rendering and responsive behaviour of the new sections were not checked in a real browser.
- Drag-and-drop ordering (arrows only); image cropping; per-page SEO.
