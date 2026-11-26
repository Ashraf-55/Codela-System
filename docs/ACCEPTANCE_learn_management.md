# Codela Learn — management system acceptance report

Generated from the automated test suite on 2026-11-24 (`npm run check` ✅ — 60+ files, 500+ tests). Evidence = test titles in `learning.test.ts, learn-site.test.ts, portal-learning.test.ts` and shared suites `governance.test.ts, platform.test.ts, security.test.ts, customer-payments.test.ts, manager-employees.test.ts`.

Evidence is attached to each criterion by matching keywords in the test titles: a ✅ row means relevant automated tests exist, not a line-by-line proof of that single criterion — read the listed titles.

**Browser status: RUN 2026-11-26** — the last full Playwright run (Chromium desktop + mobile profile) had 91 passed / 0 failed, see `docs/BROWSER_TESTING_REPORT.md`. 'BROWSER' rows below are backed by tests that really passed in that run. Still not tested: real payment gateways, e-mail / SMS / WhatsApp delivery, DNS / SSL, screen readers.

| # | Criterion | Evidence level | Result | Evidence |
|---|---|---|---|---|
| 1 | Authentication works | SHARED | ✅ API | `learning`: attendance: unique per session, only enrolled course; `platform`: pagination + validation + auth |
| 2 | Role permissions work | API | ✅ API | `learning`: expired access blocks progress; `learning`: staff roles, KPIs, reports and search |
| 3 | Create operations work | API | ✅ API | `learning`: registration action creates/reuses the student and enrols; isolation; `platform`: record limit |
| 4 | Read operations work | API | ✅ API | `learning`: public catalogue: published courses with filters, instructors, course detail without private fi; `learning`: staff roles, KPIs, reports and search |
| 5 | Update operations work | API | ✅ API | `governance`: a role with payments.update but not payments.approve is refused; with approve it works; `platform`: update and delete keep index in sync |
| 6 | Delete operations work where permitted | API | ✅ API | `learning`: publishing needs lessons; lesson positions unique; delete restricted; `governance`: staff get exactly the role permissions; changes apply at once; a role in use cannot be deleted; |
| 7 | Validation works | API | ✅ API | `learning`: payments: no overpay, partial then paid; free courses are paid immediately; `learning`: requires payment; lesson must belong to the course; computes percent and completes at 100% |
| 8 | Database persistence works | API | ✅ API | `learning`: requires payment; lesson must belong to the course; computes percent and completes at 100%; `learning`: registration action creates/reuses the student and enrols; isolation |
| 9 | Business workflows work end-to-end | API | ✅ API | `learning`: requires payment; lesson must belong to the course; computes percent and completes at 100%; `learning`: certificate needs completed course and passed exams; has a verification code; verifiable public |
| 10 | Reports reflect actual data | API | ✅ API | `learning`: staff roles, KPIs, reports and search |
| 11 | Search works | API | ✅ API | `learning`: staff roles, KPIs, reports and search |
| 12 | Tenant isolation works | API | ✅ API | `learning`: rejects foreign/duplicate questions and exams of another course; `learning`: registration action creates/reuses the student and enrols; isolation |
| 13 | Error handling works | API | ✅ API | `learning`: rejects foreign/duplicate questions and exams of another course; `portal-learning`: lesson viewer, progress, exam, assignment and certificate follow the dashboard rules |
| 14 | Important actions are audited | SHARED | ✅ API | `governance`: needs <module>.export; neutralises spreadsheet formulas; never includes another tenant; is audi |
| 15 | Plan limits are enforced | SHARED | ✅ API | `learning`: grades exactly, enforces pass mark and attempt limit, requires payment; `platform`: seeds 10 products x 3 plans and add-ons, idempotently |

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
