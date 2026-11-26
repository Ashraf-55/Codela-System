# Codela Build — website acceptance report

Generated from the automated test suite on 2026-11-24 (`npm run check` ✅ — 60+ files, 500+ tests). Evidence = test titles in `construction.test.ts, build-site.test.ts` and shared suites `site-builder.test.ts, site-domain.test.ts`.

Evidence is attached to each criterion by matching keywords in the test titles: a ✅ row means relevant automated tests exist, not a line-by-line proof of that single criterion — read the listed titles.

**Browser status: RUN 2026-11-26** — the last full Playwright run (Chromium desktop + mobile profile) had 91 passed / 0 failed, see `docs/BROWSER_TESTING_REPORT.md`. 'BROWSER' rows below are backed by tests that really passed in that run. Still not tested: real payment gateways, e-mail / SMS / WhatsApp delivery, DNS / SSL, screen readers.

| # | Criterion | Evidence level | Result | Evidence |
|---|---|---|---|---|
| 1 | Public website opens successfully | SSR | ✅ SSR smoke (all 10 products) | real HTTP render: 200, `#sec-about`, `#sec-services`, `#sec-hours`, business name |
| 2 | Homepage displays correctly (about / services / hours / branding name) | SSR | ✅ SSR smoke (all 10 products) | real HTTP render: 200, `#sec-about`, `#sec-services`, `#sec-hours`, business name |
| 3 | Navigation links work | BROWSER | ✅ BROWSER | `product-sites-responsive.spec.ts` — every menu link of the published site was checked (anchor target exists / page answers) and an anchor was clicked, at desktop, tablet and mobile widths |
| 4 | Required pages exist for this product | API | ✅ API | `build-site`: public site: team and services are public when active; inspection and quote requests share one ; `site-builder`: only owners with tenant.settings can upload site images; they are public, images only, and tena |
| 5 | Forms validate and submit | API | ✅ API | `construction`: portfolio shows completed showcased projects only; quote requests and inquiries are tenant-scop; `build-site`: public site: team and services are public when active; inspection and quote requests share one  |
| 6 | Search and filters work where applicable | API | ✅ API | `construction`: employees see projects/tasks but not budgets, quotations pricing admin, payments or purchasing; |
| 7 | Website is responsive (desktop / tablet / mobile) | BROWSER | ✅ BROWSER | `product-sites-responsive.spec.ts` — no horizontal overflow at 1280 / 820 / 390 px for the site, no sideways scroll on the dashboard; `a11y.spec.ts` axe WCAG A/AA scan of the site on desktop and mobile |
| 8 | Branding is applied correctly | SSR | ✅ SSR smoke (all 10 products) | real HTTP render: 200, `#sec-about`, `#sec-services`, `#sec-hours`, business name |
| 9 | Content comes from the correct tenant | API | ✅ API | `construction`: portfolio shows completed showcased projects only; quote requests and inquiries are tenant-scop; `site-builder`: only owners with tenant.settings can upload site images; they are public, images only, and tena |
| 10 | Dashboard changes synchronize with the website | API | ✅ API | `construction`: portfolio shows completed showcased projects only; quote requests and inquiries are tenant-scop; `build-site`: public site: team and services are public when active; inspection and quote requests share one  |
| 11 | Published content appears correctly | API | ✅ API | `construction`: portfolio shows completed showcased projects only; quote requests and inquiries are tenant-scop; `build-site`: public site: team and services are public when active; inspection and quote requests share one  |
| 12 | Draft / unpublished content stays hidden | API | ✅ API | `site-builder`: saves every field, hides drafts until republish, and keeps seo/hours/theme when an older client; `site-domain`: has a default draft; PUT validates |
| 13 | Customer-facing workflows work | API | ✅ API | `construction`: project computed fields are server-controlled; budget lines roll up; expenses track actual cost; `construction`: stock ledger: issue to a project requires the project and books a material expense; no negative |
| 14 | Domain / tenant subdomain routing works | API | ✅ API | `site-domain`: public site: unpublished 404, published visible, later drafts hidden until republish, per-tenan; `site-domain`: unknown host 404; employee without tenant.settings cannot edit |
| 15 | Unauthorized tenant data cannot be accessed | API | ✅ API | `construction`: assignments cannot overlap for a worker; work logs book labour cost; `site-domain`: unknown host 404; employee without tenant.settings cannot edit |

## All automated tests for this product (12)

- `construction` — project computed fields are server-controlled; budget lines roll up; expenses track actual cost and over-budget
- `construction` — closed projects reject new costs; dates validated
- `construction` — tasks drive progress percentage
- `construction` — integer totals; lines lock after sending; acceptance creates the project; terminal states immutable
- `construction` — stock ledger: issue to a project requires the project and books a material expense; no negative stock
- `construction` — purchase orders: totals, lifecycle, receiving adds stock and books the project cost
- `construction` — assignments cannot overlap for a worker; work logs book labour cost
- `construction` — invoice totals, issue, payments (no overpay), immutability, revenue by project
- `construction` — portfolio shows completed showcased projects only; quote requests and inquiries are tenant-scoped
- `construction` — employees see projects/tasks but not budgets, quotations pricing admin, payments or purchasing; global search works
- `build-site` — claims are cumulative, capped by the active contract, frozen once created and approved in order
- `build-site` — public site: team and services are public when active; inspection and quote requests share one inbox; before/after images are public

## Known gaps
See `docs/REMAINING_GAPS.md` (browser run, a11y automation, product-specific screens still on generic entity pages).

## Browser evidence (Playwright)

Product-specific tests from the last run:

- ✅ `a11y.spec.ts` — construction: published site, dashboard and keyboard focus [chromium]
- ✅ `all-products.spec.ts` — public site: renders, has no script errors / failed requests, fits every viewport [chromium]
- ✅ `all-products.spec.ts` — dashboard: owner sees it, logout works, the session is gone afterwards [chromium]
- ✅ `all-products.spec.ts` — tenant isolation: a second business of the same product cannot see the first one’s records [chromium]
- ✅ `product-sites-responsive.spec.ts` — construction: site + dashboard at desktop / tablet / mobile, working menu links [chromium]

Shared tests (site builder, platform features, security & isolation):

- ✅ `platform-features.spec.ts` — a new site already explains who we are and what we do; the owner's edits (SEO, hours, team, theme) appear after publishing and drafts stay hidden [chromium]
- ✅ `platform-features.spec.ts` — the builder screen saves what the owner types [chromium]
- ✅ `platform-features.spec.ts` — 30 products: page 1 of 3, Next requests page 2 from the API, search narrows the result [chromium]
- ✅ `platform-features.spec.ts` — the owner creates a role in the UI and the API enforces it for a staff member [chromium]
- ✅ `platform-features.spec.ts` — a lab technician only sees the laboratory screen; results appear in the patient portal [chromium]
- ✅ `platform-features.spec.ts` — settings, add-ons, announcements and templates load and save without console errors [chromium]
- ✅ `platform-features.spec.ts` — business: /app/stock [chromium]
- ✅ `platform-features.spec.ts` — fleet: /app/cash [chromium]
- ✅ `platform-features.spec.ts` — automotive: /app/workorders, /app/warranties [chromium]
- ✅ `platform-features.spec.ts` — construction: /app/estimates [chromium]
- ✅ `platform-features.spec.ts` — realestate: /app/commissions, /app/contracts [chromium]
- ✅ `platform-features.spec.ts` — learning: /app/course-builder [chromium]
- ✅ `platform-features.spec.ts` — medical: /app/pharmacy, /app/lab, /app/radiology [chromium]
- ✅ `platform-features.spec.ts` — realestate: the stand-alone property page has its own URL and unknown ids are 404 [chromium]
- ✅ `security-and-isolation.spec.ts` — tenant isolation: business B cannot read or change business A records [chromium]
- ✅ `security-and-isolation.spec.ts` — protected routes: anonymous users are bounced and admin APIs refuse tenant sessions [chromium]
- ✅ `security-and-isolation.spec.ts` — login lock-out after repeated wrong passwords [chromium]
- ✅ `security-and-isolation.spec.ts` — uploads: a script disguised as an image is rejected [chromium]
- ✅ `site-builder.spec.ts` — drag-and-drop section order is saved in the database and used by the published site [chromium]
- ✅ `site-builder.spec.ts` — per-page SEO slugs: create, validate duplicates and reserved words, publish, route, title, menu link [chromium]
- ✅ `site-builder.spec.ts` — image cropping: choose, adjust, preview, save the cropped file, show it on the published site [chromium]
