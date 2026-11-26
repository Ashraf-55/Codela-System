# TESTING

All numbers below come from actual runs during this build (Node 22, Linux sandbox).

| Check | Command | Result |
|---|---|---|
| Unit + integration + API tests | `npm test` | **340 passed / 27 files** (~45 s) |
| TypeScript (API/packages + web) | `npm run typecheck` | 0 errors (strict) |
| Lint | `npm run lint` | 0 errors, 0 warnings |
| Production build | `npm run build` | succeeds (Next 16, 25 routes) |
| HTTP smoke through the real proxy | `npm run build && npm run smoke` (bash + curl) | all assertions pass (register, CSRF, tenant site SSR, subdomain routing, public forms, admin analytics, 401/403/404 cases, headers) |
| Dependency audit | `npm audit --omit=dev` | 0 vulnerabilities (11 moderate dev-tooling advisories remain, see SECURITY.md) |

Method: tests were written first for each unit of behaviour and observed failing for the expected reason before implementation (red → green), then the whole suite re-run for regressions. Where a failure was caused by a wrong test expectation (not a code bug) the test was corrected and that is noted in the changelog of the work log (`docs/TASKS.md`).

## Inventory
| File | Tests |
|---|---|
| `apps/api/test/auth-tenant.test.ts` | 17 |
| `apps/api/test/automotive.test.ts` | 11 |
| `apps/api/test/booking.test.ts` | 10 |
| `apps/api/test/business.test.ts` | 10 |
| `apps/api/test/construction.test.ts` | 10 |
| `apps/api/test/ecommerce.test.ts` | 13 |
| `apps/api/test/fleet.test.ts` | 9 |
| `apps/api/test/framework.test.ts` | 9 |
| `apps/api/test/internal-ops.test.ts` | 6 |
| `apps/api/test/learning.test.ts` | 12 |
| `apps/api/test/medical.test.ts` | 22 |
| `apps/api/test/outbox.test.ts` | 4 |
| `apps/api/test/payments.test.ts` | 7 |
| `apps/api/test/platform-admin.test.ts` | 13 |
| `apps/api/test/platform.test.ts` | 21 |
| `apps/api/test/public-catalog.test.ts` | 4 |
| `apps/api/test/realestate.test.ts` | 15 |
| `apps/api/test/restaurant.test.ts` | 14 |
| `apps/api/test/security.test.ts` | 47 |
| `apps/api/test/settings.test.ts` | 4 |
| `apps/api/test/site-domain.test.ts` | 11 |
| `apps/api/test/team.test.ts` | 3 |
| `packages/db/test/tenant-scope.test.ts` | 9 |
| `packages/design/test/tokens.test.ts` | 29 |
| `packages/shared/test/money.test.ts` | 8 |
| `packages/shared/test/permissions.test.ts` | 5 |
| `packages/shared/test/subscription.test.ts` | 17 |
Highlights: `security.test.ts` (anonymous-access sweep over 43 routes, forged cookies, global rate limit, **cross-tenant sweep of every creatable entity of all 10 products**), `payments.test.ts` (idempotent checkout, signed/replayed webhooks, honest "not configured"), `outbox.test.ts` (no fake deliveries), per-product workflow suites (state machines, stock ledgers, exact integer totals, public catalogs/forms/tracking).

## What is NOT covered (be aware)
* **No browser/e2e tests**: the sandbox has no browser. The React UI is verified by type-check, lint, production build and HTTP-level smoke tests only — interaction, layout, RTL rendering, responsiveness and accessibility have **not been exercised in a browser**. Run Playwright locally before release.
* No load/performance tests; no tests against a real payment/SMS/WhatsApp/email provider; no DNS/SSL tests against real infrastructure.
* The smoke script needs bash + curl (Git Bash/WSL on Windows).

## Fifth pass (written without being able to run them — run `npm run check` first)
New tests: `account-recovery`, `portal-extras` (avatar, notifications, payments), `portal-learning`, Resend receipts (in `delivery.test.ts`), `packages/shared/test/sentry.test.ts`, `packages/db/test/schema-integrity.test.ts`. The Sentry reporter, the Svix signature check and the migration chain (16 migrations, FK check, index rules) were additionally executed directly with Node / SQLite in the authoring sandbox and passed.
`npm audit` against `registry.npmmirror.com` fails with `NOT_IMPLEMENTED` (that mirror has no audit endpoint). Use `npm run audit:prod` (points at registry.npmjs.org).
