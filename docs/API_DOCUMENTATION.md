# API_DOCUMENTATION

Base path `/api/v1`. JSON in/out: success `{ "data": …, "meta"?: { total, page, pageSize } }`; error `{ "error": { "code", "message", "fields"? } }` (`fields` = `{ field: [messages] }`, nested rows as `lines.0.desc`). Auth = httpOnly cookie (`sid` tenant users, `psid` Codela staff). Every mutating authenticated request must send `x-csrf-token` equal to the `csrf` (`pcsrf`) cookie. Global rate limit 600 req/min/IP; auth and public-form endpoints have stricter limits (`429 RATE_LIMITED`).
Error codes you will meet: `VALIDATION_ERROR` 400 · `REFERENCE_NOT_FOUND` 400 · `UNAUTHORIZED` 401 · `FORBIDDEN`/`ACCOUNT_SUSPENDED` 403 · `PLAN_LIMIT_EXCEEDED` 403 · `SUBSCRIPTION_INACTIVE` 402 · `NOT_FOUND` 404 · `CONFLICT`/`IN_USE`/`IMMUTABLE`/`INVALID_TRANSITION` 409 · `METHOD_NOT_ALLOWED` 405 (append-only/system records) · `PAYMENT_NOT_CONFIGURED` 501 + product-specific 409 codes (`SLOT_TAKEN`, `INSUFFICIENT_STOCK`, `OVERPAYMENT`, …).

## Public (no session)
| Method & path | Purpose |
|---|---|
| `GET /health` | liveness |
| `GET /public/products` · `GET /public/plans?productSlug=` | marketing data (active products/plans only) |
| `POST /public/leads` | demo/contact request → Codela sales pipeline (honeypot `website`, rate limited) |
| `GET /public/site` · `GET /public/site-meta` | published tenant site + its public catalogs/forms (tenant from Host) |
| `GET /public/catalog/:entity?…filters&sort&page` | public catalog of an entity flagged `public` (forced availability filters) |
| `POST /public/forms/:key` | public forms (inquiries, booking requests, …) |
| `GET\|POST /public/actions/:key` | product actions: `quote`, `checkout`, `track`, `availability`, `book`, `status`, `cancel`, `course`, `register`, `verify`, `order` |
| `POST /webhooks/:provider` | signed payment webhooks (idempotent) |

## Auth
`POST /auth/register-business` (creates tenant + owner + trial) · `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` · staff: `POST /platform/auth/login`, `POST /platform/auth/logout`, `GET /platform/me`.

## Tenant (session + permissions)
| Area | Endpoints |
|---|---|
| Generic product data | `GET /tenant/p-meta` · `GET /tenant/dashboard` · `GET /tenant/reports/:key` · `GET\|POST /tenant/p/:entity` · `GET\|PATCH\|DELETE /tenant/p/:entity/:id` (list supports `q`, `page`, `pageSize`, `sort`, `dir`, equality filters and `<field>_from/_to` ranges for declared filterable fields) |
| Search | `GET /search?q=&page=&pageSize=&type=` (tenant + permission scoped) |
| Subscription | `GET /tenant/subscription` · `POST …/checkout` · `POST …/checkout/:txId/sandbox-confirm` · `POST …/activate` (sandbox shortcut) · `POST …/cancel` · `POST …/change-plan` · `GET /tenant/billing/invoices` |
| Add-ons | `GET /tenant/addons` · `POST /tenant/addons/:key/activate` · `POST …/cancel` |
| Website & domains | `GET\|PUT /tenant/site` · `POST /tenant/site/publish` · `GET\|POST /tenant/domains` · `POST …/:id/verify` · `POST …/:id/primary` · `DELETE …/:id` |
| Team & settings | `GET\|POST /tenant/employees` · `PATCH /tenant/employees/:id` · `GET\|PATCH /tenant/settings` · `GET /tenant/audit-logs` |
| Messaging | `GET /tenant/notifications` · `POST …/:id/read` · `GET /tenant/outbox` · `POST /tenant/outbox/:id/retry` |

## Codela platform (staff session)
`GET /platform/tenants[?q&product&status&subscription&page]` · `GET /platform/tenants/:id` · `PATCH /platform/tenants/:id/status` · `GET /platform/products` · `PATCH /platform/products/:slug` · `GET /platform/plans` · `PATCH /platform/plans/:id` · `GET\|POST /platform/addons` · `PATCH /platform/addons/:key` · `GET /platform/analytics` · `GET\|POST /platform/leads` · `GET /platform/leads/pipeline` · `PATCH /platform/leads/:id` · `GET\|POST /platform/tasks` · `PATCH /platform/tasks/:id` · `GET\|PUT /platform/settings/:key` · `POST /platform/staff` · `GET /platform/audit-logs`.

## Product entities
`GET /tenant/p-meta` returns, for the signed-in user, every readable entity of the tenant's product with its fields, types, enums and permissions — that is the authoritative per-product reference. Each product's rules live in `apps/api/src/products/defs/<product>.ts` and are exercised by `apps/api/test/<product>.test.ts`.
