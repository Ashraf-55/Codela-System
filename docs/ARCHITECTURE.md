# ARCHITECTURE

Status: describes what is **actually implemented** (see FINAL_REPORT.md for the feature-by-feature classification).

## 1. Stack
| Layer | Technology |
|---|---|
| Web | Next.js 16 (App Router) · React 19 · TypeScript · plain CSS with design tokens (logical properties, RTL/LTR, light/dark) |
| API | Node ≥ 22 · Express 4 · TypeScript (tsx) · zod 4 validation · helmet · express-rate-limit |
| Data | SQLite (better-sqlite3) via **Drizzle ORM** + generated SQL migrations (`packages/db/migrations`, applied automatically at startup) |
| Tests | Vitest + Supertest (API/integration), `scripts/smoke.sh` (HTTP smoke through the real Next proxy) |
| Tooling | ESLint 9 + typescript-eslint, `tsc --noEmit` |

> **Deviation (documented):** the specification asks for Prisma "or an equivalent". Prisma's engine binaries could not be downloaded in the build sandbox, which would have made every database test unverifiable, so Drizzle ORM was used. All data access goes through typed repositories/`Db`, so moving to PostgreSQL is a driver + dialect change (see DEPLOYMENT.md).

## 2. Monorepo layout
```
apps/api            Express API (auth, tenants, billing, search, product routes, platform admin)
apps/api/src/products   declarative product framework + the 10 product definitions (src/products/defs/*.ts)
apps/web            Next.js: marketing site, onboarding, tenant dashboards, Super Admin UI, tenant public websites
packages/db         Drizzle schema, migrations, seed (products/plans/add-ons), tenant-scoped repository
packages/shared     money (integer minor units), permissions, subscription state machine
packages/design     per-product design tokens (WCAG-AA tested), RTL helpers
scripts/smoke.sh    end-to-end HTTP smoke test
docs/               this documentation
```

## 3. Request flow
`Browser → Next (same origin) → /api/v1/[...path] route handler (cookie + CSRF header + tenant host forwarding) → Express API → SQLite`.
Tenant public websites are server-rendered by Next (`/sites/[slug]`, or any non-Codela host via middleware rewrite) using the API's public endpoints; the API resolves the tenant **only** from a verified custom domain or `<slug>.<ROOT_DOMAIN>`.

## 4. Key design decisions
1. **Money** is always an integer in minor units + currency (KWD = 3 digits). Taxes/commissions are basis points with half-up integer rounding. No floats anywhere in financial paths.
2. **Tenant isolation** is enforced server-side in three layers: (a) tenant comes from the session / verified host, never from request input; (b) every query is built with the tenant id (`scoped()` repos and `records.tenantId` predicates); (c) a generated cross-tenant sweep test exercises every creatable entity of all 10 products.
3. **Subscriptions** are a pure state machine (`packages/shared/src/subscription.ts`), lazily ticked on access. Lapsed accounts become read-only; data is never deleted.
4. **Entitlements** (employee/record limits, custom domain, premium templates, SMS/WhatsApp…) are checked on the backend from plan limits + active add-on grants.
5. **Declarative product framework** (`apps/api/src/products`): each product is a typed definition (entities, fields, validation, search fields, permissions module, KPIs, reports, public catalogs/forms/actions) plus hand-written workflow hooks (state machines, stock ledgers, totals). Generic CRUD, search indexing, audit, dashboards and the schema-driven UI are all derived from it.
6. **Global search** is a tenant-scoped, permission-filtered `search_index` maintained transactionally by every create/update/delete; queries are LIKE-escaped, case-insensitive, Arabic-digit-normalised and paginated.
7. **Payments / messaging** are provider boundaries (`PaymentGateway`, `NotificationProvider`). Only a sandbox gateway exists; nothing is ever reported as paid or delivered unless a provider really did it (`simulated` / `no_provider` statuses).

## 5. Implementation deviations (honest record)
1. Drizzle instead of Prisma (above).
2. **Product entities live in one `records` table** (JSON `data`, indexed `entity_type`, per-tenant unique `code` / `unique_key`). Reference existence, restrict-on-delete, uniqueness, immutability and state machines are enforced in the service layer inside transactions — not by database foreign keys. Platform, billing, identity, site, domain and outbox tables are normal relational tables with FKs. Chosen to make ten products feasible with uniform validation/search/permissions; hot entities can be normalised later.
3. Tailwind is not used (plain CSS tokens instead) — the spec says "where appropriate".
4. Web fonts are not bundled (offline-safe font stacks); add self-hosted fonts in production.
