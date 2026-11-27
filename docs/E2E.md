# End-to-end tests (Playwright) — exact local commands

Status (2026-11-27): **executed — 99 passed, 0 failed, 0 flaky, 0 skipped (2026-11-27)** (see BROWSER_TESTING_REPORT.md). Use `E2E_RELAX_RATE_LIMITS=1` on the API and `E2E_CHROMIUM_PATH` if the browser build does not match Playwright.

```bash
# 1. repo root
npm install
npm run dev:api          # terminal 1
npm run dev:web          # terminal 2
# 2. e2e (separate package on purpose)
cd e2e
npm install
npx playwright install chromium
npm test                 # or: npm run test:headed
```
Env: `E2E_BASE_URL` (default `http://localhost:3000`). Each test registers throw-away businesses (`e2e…` slugs): use a scratch `DATABASE_FILE`.
Reports/evidence: `docs/qa/evidence/` (HTML report, JSON results, traces, screenshots, videos on failure).

## What is covered
| Spec | Covers |
|---|---|
| `all-products.spec.ts` | For each of the 10 products: register + publish, public site renders with no script errors / failed requests / 5xx, no horizontal scroll at desktop/tablet/mobile, dashboard loads, logout kills the session, protected route bounces, cross-tenant read returns 404. Plus Super Admin separation |
| `medical-journey.spec.ts` | Full clinic workflow |
| `security-and-isolation.spec.ts` | Isolation, lock-out, upload rejection |
| `responsive.spec.ts` | Mobile project |

## Not covered by browser tests yet
Product-specific UI journeys for Estate, Commerce (cart/checkout), Restaurant (POS/kitchen), Auto, Learn (student portal), Build, Booking (wizard), Fleet (driver portal) and the Super Admin screens, manual payments submit/approve/reject, uploads in the website builder. Those flows are covered by the API test-suite only.


## Added 2026-11-24
`e2e/tests/platform-features.spec.ts` — website builder output (about/services/hours, SEO, team, theme, drafts hidden), store paging (30 products, page 2, search), custom roles, lab technician + pharmacy screens, Super Admin screens (needs `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`, otherwise skipped).
Create a platform admin for local runs with the existing helper (`createPlatformStaff`) or the seed script, then:
```
E2E_ADMIN_EMAIL=admin@codela.local E2E_ADMIN_PASSWORD='…' npm test --prefix e2e
```
**Not run** in the authoring environment (no browser). `docs/BROWSER_TESTING_REPORT.md` says so.


## Exact commands used for the recorded run (sixth pass)

```bash
npm install && (cd e2e && npm install)           # installs @playwright/test and @axe-core/playwright
npm run build                                    # production build of the web app
# terminal 1 – API on a scratch database (the E2E flags are ignored when NODE_ENV=production)
E2E_RELAX_RATE_LIMITS=1 NODE_ENV=development PORT=4000 ROOT_DOMAIN=localhost DATABASE_FILE=/tmp/e2e.db CSRF_SECRET=e2e-secret-e2e-secret-e2e-secret-123 npm run start:api
# terminal 2 – web
(cd apps/web && API_URL=http://127.0.0.1:4000 ROOT_DOMAIN=localhost npx next start -p 3000)
# terminal 3 – tests (desktop + mobile projects). Add E2E_CHROMIUM_PATH=... if `npx playwright install chromium` is not possible.
cd e2e && npx playwright test --reporter=list,json
```

Specs: `all-products` (10 products × auth, dashboard, CRUD, isolation), `medical-journey`, `platform-features`, `security-and-isolation`, `responsive` (platform pages, RTL), **`product-sites-responsive`** (every product's published site + dashboard at desktop / tablet / mobile, real menu-link checks), **`a11y`** (axe-core WCAG 2.0/2.1 A+AA on every product), **`site-builder`** (drag-and-drop order, per-page slugs, image cropping), **`estate-map`**, **`lesson-media`** (video upload through the proxy, Range streaming, paid-only access, material download), **`quotations`**, **`lead-performance`**.
Results of the last run are in `docs/qa/evidence/playwright-results.json`.
