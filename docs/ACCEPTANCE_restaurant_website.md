# Codela Restaurant — website acceptance report

Generated from the automated test suite on 2026-11-24 (`npm run check` ✅ — 60+ files, 500+ tests). Evidence = test titles in `restaurant.test.ts` and shared suites `site-builder.test.ts, site-domain.test.ts`.

Evidence is attached to each criterion by matching keywords in the test titles: a ✅ row means relevant automated tests exist, not a line-by-line proof of that single criterion — read the listed titles.

**Browser status: RUN 2026-11-26** — the last full Playwright run (Chromium desktop + mobile profile) had 91 passed / 0 failed, see `docs/BROWSER_TESTING_REPORT.md`. 'BROWSER' rows below are backed by tests that really passed in that run. Still not tested: real payment gateways, e-mail / SMS / WhatsApp delivery, DNS / SSL, screen readers.

| # | Criterion | Evidence level | Result | Evidence |
|---|---|---|---|---|
| 1 | Public website opens successfully | SSR | ✅ SSR smoke (all 10 products) | real HTTP render: 200, `#sec-about`, `#sec-services`, `#sec-hours`, business name |
| 2 | Homepage displays correctly (about / services / hours / branding name) | SSR | ✅ SSR smoke (all 10 products) | real HTTP render: 200, `#sec-about`, `#sec-services`, `#sec-hours`, business name |
| 3 | Navigation links work | BROWSER | ✅ BROWSER | `product-sites-responsive.spec.ts` — every menu link of the published site was checked (anchor target exists / page answers) and an anchor was clicked, at desktop, tablet and mobile widths |
| 4 | Required pages exist for this product | API | ✅ API | `restaurant`: menu shows only available items; branches public; tables/recipes private; `restaurant`: online order (takeaway/delivery only) and tracking by phone; reservation form; isolation |
| 5 | Forms validate and submit | API | ✅ API | `restaurant`: online order (takeaway/delivery only) and tracking by phone; reservation form; isolation |
| 6 | Search and filters work where applicable | API | ✅ API | `restaurant`: kitchen display = orders filtered by status; delivery goes out_for_delivery; `restaurant`: global search: menu items, tables, reservations, orders |
| 7 | Website is responsive (desktop / tablet / mobile) | BROWSER | ✅ BROWSER | `product-sites-responsive.spec.ts` — no horizontal overflow at 1280 / 820 / 390 px for the site, no sideways scroll on the dashboard; `a11y.spec.ts` axe WCAG A/AA scan of the site on desktop and mobile |
| 8 | Branding is applied correctly | SSR | ✅ SSR smoke (all 10 products) | real HTTP render: 200, `#sec-about`, `#sec-services`, `#sec-hours`, business name |
| 9 | Content comes from the correct tenant | API | ✅ API | `restaurant`: online order (takeaway/delivery only) and tracking by phone; reservation form; isolation; `restaurant`: a POS order that does not state a tax rate gets the tenant default; an explicit rate wins |
| 10 | Dashboard changes synchronize with the website | API | ✅ API | `restaurant`: menu shows only available items; branches public; tables/recipes private; `restaurant`: waste is recorded through the ledger and cannot exceed stock; only active offers are public |
| 11 | Published content appears correctly | API | ✅ API | `restaurant`: menu shows only available items; branches public; tables/recipes private; `restaurant`: waste is recorded through the ledger and cannot exceed stock; only active offers are public |
| 12 | Draft / unpublished content stays hidden | API | ✅ API | `restaurant`: menu shows only available items; branches public; tables/recipes private; `restaurant`: waste is recorded through the ledger and cannot exceed stock; only active offers are public |
| 13 | Customer-facing workflows work | API | ✅ API | `restaurant`: cancel while preparing returns ingredients; cannot cancel after ready; transitions follow order; `restaurant`: payment sets paidAt and creates one invoice; completion requires payment and frees the table |
| 14 | Domain / tenant subdomain routing works | API | ✅ API | `site-domain`: public site: unpublished 404, published visible, later drafts hidden until republish, per-tenan; `site-domain`: unknown host 404; employee without tenant.settings cannot edit |
| 15 | Unauthorized tenant data cannot be accessed | API | ✅ API | `restaurant`: cancel while preparing returns ingredients; cannot cancel after ready; transitions follow order; `restaurant`: menu shows only available items; branches public; tables/recipes private |

## All automated tests for this product (22)

- `restaurant` — menu CRUD with extras validation; ingredient stock is ledger-driven
- `restaurant` — computes extras, discount, service charge and tax exactly; ignores client prices
- `restaurant` — validates order shape: table for dine-in, delivery contact, unknown extras, unavailable items, out-of-service tables
- `restaurant` — deducts recipe ingredients when preparing; insufficient stock blocks the transition atomically
- `restaurant` — cancel while preparing returns ingredients; cannot cancel after ready; transitions follow order type
- `restaurant` — payment sets paidAt and creates one invoice; completion requires payment and frees the table
- `restaurant` — kitchen display = orders filtered by status; delivery goes out_for_delivery
- `restaurant` — one open shift; closing computes expected cash and difference; closed shifts are immutable
- `restaurant` — closing requires closingCash
- `restaurant` — prevents table clashes and oversize parties; confirmation needs a table
- `restaurant` — menu shows only available items; branches public; tables/recipes private
- `restaurant` — online order (takeaway/delivery only) and tracking by phone; reservation form; isolation
- `restaurant` — employee runs orders but cannot see recipes/ingredient ledger edits/shifts reports; KPIs real
- `restaurant` — global search: menu items, tables, reservations, orders
- `restaurant` — a POS order that does not state a tax rate gets the tenant default; an explicit rate wins
- `restaurant` — a purchase computes its total on the server and receiving it adds each ingredient to stock exactly once; terminal purchases are immutable
- `restaurant` — waste is recorded through the ledger and cannot exceed stock; only active offers are public
- `restaurant` — profit = sales - cost of goods (recipe qty x purchase cost) - waste; cancelling while preparing gives the cost back; supplier debt is tracked
- `restaurant` — a bill can be split into several payments; the order is paid and invoiced only when they add up to the total
- `restaurant` — an open dine-in order can move to a free table; the old table is freed and the new one occupied; busy/other-type moves are refused
- `restaurant` — branch stock is separate: movements, order deductions and transfers never touch another branch
- `restaurant` — the ledger is system-written only and isolated between tenants

## Known gaps
See `docs/REMAINING_GAPS.md` (browser run, a11y automation, product-specific screens still on generic entity pages).

## Browser evidence (Playwright)

Product-specific tests from the last run:

- ✅ `a11y.spec.ts` — restaurant: published site, dashboard and keyboard focus [chromium]
- ✅ `all-products.spec.ts` — public site: renders, has no script errors / failed requests, fits every viewport [chromium]
- ✅ `all-products.spec.ts` — dashboard: owner sees it, logout works, the session is gone afterwards [chromium]
- ✅ `all-products.spec.ts` — tenant isolation: a second business of the same product cannot see the first one’s records [chromium]
- ✅ `product-sites-responsive.spec.ts` — restaurant: site + dashboard at desktop / tablet / mobile, working menu links [chromium]

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
