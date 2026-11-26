# Codela Learn — website acceptance report

Generated from the automated test suite on 2026-11-24 (`npm run check` ✅ — 60+ files, 500+ tests). Evidence = test titles in `learning.test.ts, learn-site.test.ts, portal-learning.test.ts` and shared suites `site-builder.test.ts, site-domain.test.ts`.

Evidence is attached to each criterion by matching keywords in the test titles: a ✅ row means relevant automated tests exist, not a line-by-line proof of that single criterion — read the listed titles.

**Browser status: RUN 2026-11-26** — the last full Playwright run (Chromium desktop + mobile profile) had 91 passed / 0 failed, see `docs/BROWSER_TESTING_REPORT.md`. 'BROWSER' rows below are backed by tests that really passed in that run. Still not tested: real payment gateways, e-mail / SMS / WhatsApp delivery, DNS / SSL, screen readers.

| # | Criterion | Evidence level | Result | Evidence |
|---|---|---|---|---|
| 1 | Public website opens successfully | SSR | ✅ SSR smoke (all 10 products) | real HTTP render: 200, `#sec-about`, `#sec-services`, `#sec-hours`, business name |
| 2 | Homepage displays correctly (about / services / hours / branding name) | SSR | ✅ SSR smoke (all 10 products) | real HTTP render: 200, `#sec-about`, `#sec-services`, `#sec-hours`, business name |
| 3 | Navigation links work | BROWSER | ✅ BROWSER | `product-sites-responsive.spec.ts` — every menu link of the published site was checked (anchor target exists / page answers) and an anchor was clicked, at desktop, tablet and mobile widths |
| 4 | Required pages exist for this product | API | ✅ API | `learning`: public catalogue: published courses with filters, instructors, course detail without private fi; `learning`: certificate needs completed course and passed exams; has a verification code; verifiable public |
| 5 | Forms validate and submit | API | ⚠️ no dedicated automated test | — |
| 6 | Search and filters work where applicable | API | ✅ API | `learning`: public catalogue: published courses with filters, instructors, course detail without private fi; `learning`: staff roles, KPIs, reports and search |
| 7 | Website is responsive (desktop / tablet / mobile) | BROWSER | ✅ BROWSER | `product-sites-responsive.spec.ts` — no horizontal overflow at 1280 / 820 / 390 px for the site, no sideways scroll on the dashboard; `a11y.spec.ts` axe WCAG A/AA scan of the site on desktop and mobile |
| 8 | Branding is applied correctly | SSR | ✅ SSR smoke (all 10 products) | real HTTP render: 200, `#sec-about`, `#sec-services`, `#sec-hours`, business name |
| 9 | Content comes from the correct tenant | API | ✅ API | `learning`: registration action creates/reuses the student and enrols; isolation; `site-builder`: only owners with tenant.settings can upload site images; they are public, images only, and tena |
| 10 | Dashboard changes synchronize with the website | API | ✅ API | `learning`: public catalogue: published courses with filters, instructors, course detail without private fi; `learning`: only published courses; unique pair; capacity; price snapshot |
| 11 | Published content appears correctly | API | ✅ API | `learning`: publishing needs lessons; lesson positions unique; delete restricted; `learning`: public catalogue: published courses with filters, instructors, course detail without private fi |
| 12 | Draft / unpublished content stays hidden | API | ✅ API | `learning`: public catalogue: published courses with filters, instructors, course detail without private fi; `learning`: only published courses; unique pair; capacity; price snapshot |
| 13 | Customer-facing workflows work | API | ✅ API | `learning`: payments: no overpay, partial then paid; free courses are paid immediately; `learning`: requires payment; lesson must belong to the course; computes percent and completes at 100% |
| 14 | Domain / tenant subdomain routing works | API | ✅ API | `site-domain`: public site: unpublished 404, published visible, later drafts hidden until republish, per-tenan; `site-domain`: unknown host 404; employee without tenant.settings cannot edit |
| 15 | Unauthorized tenant data cannot be accessed | API | ✅ API | `learning`: public catalogue: published courses with filters, instructors, course detail without private fi; `learning`: rejects foreign/duplicate questions and exams of another course |

## All automated tests for this product (16)

- `learning` — publishing needs lessons; lesson positions unique; delete restricted
- `learning` — public catalogue: published courses with filters, instructors, course detail without private fields
- `learning` — only published courses; unique pair; capacity; price snapshot
- `learning` — payments: no overpay, partial then paid; free courses are paid immediately
- `learning` — requires payment; lesson must belong to the course; computes percent and completes at 100%
- `learning` — expired access blocks progress
- `learning` — grades exactly, enforces pass mark and attempt limit, requires payment
- `learning` — rejects foreign/duplicate questions and exams of another course
- `learning` — attendance: unique per session, only enrolled course
- `learning` — certificate needs completed course and passed exams; has a verification code; verifiable publicly
- `learning` — registration action creates/reuses the student and enrols; isolation
- `learning` — staff roles, KPIs, reports and search
- `learn-site` — reviews need an enrolled student and staff approval; FAQ shows active only; groups check enrolment, duplicates and capacity
- `portal-learning` — lesson viewer, progress, exam, assignment and certificate follow the dashboard rules
- `portal-learning` — hides lesson content until paid, blocks writes, and never shows another student\'s enrolment
- `portal-learning` — is not available on other products

## Known gaps
See `docs/REMAINING_GAPS.md` (browser run, a11y automation, product-specific screens still on generic entity pages).

## Browser evidence (Playwright)

Product-specific tests from the last run:

- ✅ `a11y.spec.ts` — learning: published site, dashboard and keyboard focus [chromium]
- ✅ `all-products.spec.ts` — public site: renders, has no script errors / failed requests, fits every viewport [chromium]
- ✅ `all-products.spec.ts` — dashboard: owner sees it, logout works, the session is gone afterwards [chromium]
- ✅ `all-products.spec.ts` — tenant isolation: a second business of the same product cannot see the first one’s records [chromium]
- ✅ `lesson-media.spec.ts` — Learn: owner uploads a lesson video + material in the course builder; a paid student streams and downloads them in the portal [chromium]
- ✅ `product-sites-responsive.spec.ts` — learning: site + dashboard at desktop / tablet / mobile, working menu links [chromium]

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
