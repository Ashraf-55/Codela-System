# Codela SaaS Ecosystem

Ten specialised SaaS products (Medical, Real Estate, E-Commerce, Restaurant, Automotive, Learning, Construction, Booking, Fleet & Delivery, Business) on one multi-tenant platform: each subscriber gets a branded website, a management dashboard, subscriptions, add-ons, global search and reports.

> **Read docs/FINAL_REPORT.md first** — it states exactly what is finished, verified, simulated or missing. Current verification: lint + typecheck clean, 516 vitest tests, production build OK, Playwright 91 passed + 1 flaky / 0 failed, axe-core no violations (`docs/BROWSER_TESTING_REPORT.md`, `docs/ACCESSIBILITY_REPORT.md`, `docs/REMAINING_GAPS.md`). Browser tests: `docs/E2E.md`.

## Requirements
Node.js ≥ 22 (uses `process.loadEnvFile` and native `better-sqlite3`), npm ≥ 10. bash + curl only for `npm run smoke`.

Note: `.npmrc` sets `ignore-scripts=true` (better-sqlite3 ships prebuilt binaries for Windows/macOS/Linux, so no compiler is needed).

## Install & run (PowerShell)
```powershell
npm ci
copy .env.example .env                    # then edit: CSRF_SECRET, PAYMENT_PROVIDER=sandbox for local dev, TRUST_PROXY=loopback
$env:ADMIN_EMAIL="you@codela.tech"; $env:ADMIN_PASSWORD="<strong password, 10+ chars>"; npm run create-admin
npm run dev:api                           # terminal 1 → http://localhost:4000  (creates ./data/codela.db and applies migrations)
npm run dev:web                           # terminal 2 → http://localhost:3000
```
* Customers: <http://localhost:3000/register> → dashboard at `/app`. Codela staff: `/admin/login`.
* Tenant website preview: `http://localhost:3000/sites/<your-slug>` (publish it from *Website & branding* first).
* The web app proxies `/api/v1/*` to the API (`API_URL`, default `http://127.0.0.1:4000`).

## Commands
| Task | Command |
|---|---|
| All tests | `npm test` |
| Lint / types | `npm run lint` · `npm run typecheck` |
| Production build | `npm run build` then `npm run start:api` and `npm run start:web` |
| Everything | `npm run check` |
| HTTP smoke test | `npm run build && npm run smoke` |
| New migration after editing `packages/db/src/schema.ts` | `npm run db:generate` |
| Create a super admin | `npm run create-admin` (env `ADMIN_EMAIL`, `ADMIN_PASSWORD`) |

## Documentation
FINAL_REPORT · ARCHITECTURE · IMPLEMENTATION_PLAN · DATABASE_SCHEMA · API_DOCUMENTATION · SECURITY · TESTING · SUBSCRIPTION_SYSTEM · TENANT_ARCHITECTURE · DEPLOYMENT · CHANGELOG (all in `docs/`), `.env.example`, work log `docs/TASKS.md`.


## Recent additions (2026-11-24)
Public sites with built-in "who we are / what we do" content, an extended website builder (SEO, hours, team, gallery, theme), custom roles and CSV export, monthly add-on renewals, Super Admin settings / add-ons / announcements / notification templates / customer detail, medical lab-pharmacy-radiology screens, booking refunds. Status and gaps: `docs/REMAINING_GAPS.md`. Browser (Playwright) tests have **not** been run yet: `docs/E2E.md`.
