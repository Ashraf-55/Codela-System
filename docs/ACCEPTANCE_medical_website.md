# Codela Med — website acceptance report

Generated from the automated test suite on 2026-11-24 (`npm run check` ✅ — 60+ files, 500+ tests). Evidence = test titles in `medical.test.ts, portal-results.test.ts` and shared suites `site-builder.test.ts, site-domain.test.ts`.

Evidence is attached to each criterion by matching keywords in the test titles: a ✅ row means relevant automated tests exist, not a line-by-line proof of that single criterion — read the listed titles.

**Browser status: RUN 2026-11-26** — the last full Playwright run (Chromium desktop + mobile profile) had 91 passed / 0 failed, see `docs/BROWSER_TESTING_REPORT.md`. 'BROWSER' rows below are backed by tests that really passed in that run. Still not tested: real payment gateways, e-mail / SMS / WhatsApp delivery, DNS / SSL, screen readers.

| # | Criterion | Evidence level | Result | Evidence |
|---|---|---|---|---|
| 1 | Public website opens successfully | SSR | ✅ SSR smoke (all 10 products) | real HTTP render: 200, `#sec-about`, `#sec-services`, `#sec-hours`, business name |
| 2 | Homepage displays correctly (about / services / hours / branding name) | SSR | ✅ SSR smoke (all 10 products) | real HTTP render: 200, `#sec-about`, `#sec-services`, `#sec-hours`, business name |
| 3 | Navigation links work | BROWSER | ✅ BROWSER | `product-sites-responsive.spec.ts` — every menu link of the published site was checked (anchor target exists / page answers) and an anchor was clicked, at desktop, tablet and mobile widths |
| 4 | Required pages exist for this product | API | ✅ API | `medical`: public doctor/service catalog exposes only public fields of active records; `medical`: working hours are public for the doctor profile, without private data |
| 5 | Forms validate and submit | API | ✅ API | `medical`: prevents double booking, allows adjacent, cancelled frees the slot, other doctor ok; `medical`: inquiry + appointment-request forms create records in the right tenant only; honeypot ignored |
| 6 | Search and filters work where applicable | API | ✅ API | `medical`: creates patients with auto codes, validates, filters, searches, sorts, paginates; `medical`: reading a sensitive medical record is audit-logged; global search hides it from employees |
| 7 | Website is responsive (desktop / tablet / mobile) | BROWSER | ✅ BROWSER | `product-sites-responsive.spec.ts` — no horizontal overflow at 1280 / 820 / 390 px for the site, no sideways scroll on the dashboard; `a11y.spec.ts` axe WCAG A/AA scan of the site on desktop and mobile |
| 8 | Branding is applied correctly | SSR | ✅ SSR smoke (all 10 products) | real HTTP render: 200, `#sec-about`, `#sec-services`, `#sec-hours`, business name |
| 9 | Content comes from the correct tenant | API | ✅ API | `medical`: tenant isolation: list/get/patch/delete and cross-tenant references; `medical`: unique keys: specialty names unique per tenant, not globally |
| 10 | Dashboard changes synchronize with the website | API | ✅ API | `medical`: public doctor/service catalog exposes only public fields of active records; `medical`: working hours are public for the doctor profile, without private data |
| 11 | Published content appears correctly | API | ✅ API | `medical`: public doctor/service catalog exposes only public fields of active records; `medical`: working hours are public for the doctor profile, without private data |
| 12 | Draft / unpublished content stays hidden | API | ✅ API | `medical`: working hours are public for the doctor profile, without private data; `medical`: only active FAQs and published articles are public; doctor photo is a public field; drafts stay |
| 13 | Customer-facing workflows work | API | ✅ API | `medical`: prevents double booking, allows adjacent, cancelled frees the slot, other doctor ok; `medical`: payments: only on issued invoices, no overpay, partial -> paid, invoice becomes immutable |
| 14 | Domain / tenant subdomain routing works | API | ✅ API | `site-domain`: public site: unpublished 404, published visible, later drafts hidden until republish, per-tenan; `site-domain`: unknown host 404; employee without tenant.settings cannot edit |
| 15 | Unauthorized tenant data cannot be accessed | API | ✅ API | `medical`: tenant isolation: list/get/patch/delete and cross-tenant references; `medical`: cannot delete records that are referenced (restrict) |

## All automated tests for this product (37)

- `medical` — exposes only this product\'s entities
- `medical` — creates patients with auto codes, validates, filters, searches, sorts, paginates
- `medical` — update validates, strips mass-assignment, returns 404 for missing
- `medical` — tenant isolation: list/get/patch/delete and cross-tenant references
- `medical` — unique keys: specialty names unique per tenant, not globally
- `medical` — cannot delete records that are referenced (restrict)
- `medical` — prevents double booking, allows adjacent, cancelled frees the slot, other doctor ok
- `medical` — respects doctor weekly schedule when defined
- `medical` — status transitions are validated
- `medical` — computes totals server-side with integer math and ignores client totals
- `medical` — rejects discount larger than subtotal
- `medical` — payments: only on issued invoices, no overpay, partial -> paid, invoice becomes immutable
- `medical` — front-desk employee: patients/appointments yes, medical records/prescriptions no, no deletes
- `medical` — manager has full module access
- `medical` — reading a sensitive medical record is audit-logged; global search hides it from employees
- `medical` — indexes patients/doctors/appointments/invoices; updates and deletes stay in sync
- `medical` — KPIs are computed from real records
- `medical` — read-only after expiry: reads ok, writes 402
- `medical` — record limit counts product records
- `medical` — public doctor/service catalog exposes only public fields of active records
- `medical` — inquiry + appointment-request forms create records in the right tenant only; honeypot ignored
- `medical` — lists the readable reports so the UI can render them
- `medical` — offers only free slots from the doctor schedule; booking creates the patient + a scheduled appointment the reception sees; the slot is then taken
- `medical` — rejects unknown doctors, off-schedule/past/off-grid times and bad input; another clinic cannot book this clinic\'s doctor
- `medical` — the patient tracks and cancels with code + phone only; cancelling frees the slot; confirmed ones can be cancelled, completed ones cannot
- `medical` — working hours are public for the doctor profile, without private data
- `medical` — only active FAQs and published articles are public; doctor photo is a public field; drafts stay hidden
- `medical` — completing an appointment prepares one draft invoice (service price, else doctor fee); none without a price; reception can issue and collect
- `medical` — pharmacy: stock only moves through the ledger; a dispense prices from the catalogue, checks stock atomically, and cancelling returns stock
- `medical` — radiology: requested -> scheduled -> performed -> reported, a report text is required, no skipping
- `medical` — branches with a map are public; online slots carry the branch of the schedule window; the booking stores it
- `medical` — "in the past" follows the clinic timezone, not UTC
- `medical` — pharmacist, lab technician and radiology technician only reach their own modules (API-enforced)
- `medical` — pharmacist works the pharmacy only
- `medical` — the patient reschedules from the public site with code + phone; the slot is re-validated and the old one is freed
- `portal-results` — a patient sees only their own results, and only after the lab / radiology has finished (never a draft)
- `portal-results` — the medication catalogue carries batch and expiry for the pharmacist

## Known gaps
See `docs/REMAINING_GAPS.md` (browser run, a11y automation, product-specific screens still on generic entity pages).

## Browser evidence (Playwright)

Product-specific tests from the last run:

- ✅ `a11y.spec.ts` — medical: published site, dashboard and keyboard focus [chromium]
- ✅ `all-products.spec.ts` — public site: renders, has no script errors / failed requests, fits every viewport [chromium]
- ✅ `all-products.spec.ts` — dashboard: owner sees it, logout works, the session is gone afterwards [chromium]
- ✅ `all-products.spec.ts` — tenant isolation: a second business of the same product cannot see the first one’s records [chromium]
- ✅ `medical-journey.spec.ts` — Codela Med: full clinic workflow [chromium]
- ✅ `product-sites-responsive.spec.ts` — medical: site + dashboard at desktop / tablet / mobile, working menu links [chromium]

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
