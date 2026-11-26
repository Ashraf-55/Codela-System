# DATABASE AUDIT (phase 10)

Method: every migration in `packages/db/migrations/meta/_journal.json` order was applied to an empty SQLite database (16 migrations, 31 tables), then `PRAGMA foreign_key_check`, `table_info`, `index_list` and `foreign_key_list` were inspected. The same rules now run in CI as `packages/db/test/schema-integrity.test.ts`.

## Result
| Check | Result |
|---|---|
| All 16 migrations apply cleanly in order | ✔ (executed) |
| `foreign_key_check` (dangling references) | 0 rows ✔ |
| Foreign keys enforced at runtime (`PRAGMA foreign_keys = ON` in `createDb`) | ✔ |
| Journal ↔ SQL files one to one, contiguous idx | ✔ (test) |
| Every tenant-owned table has an index starting with `tenant_id` | ✔ after migration 0015 |
| Every foreign-key column is the first column of an index | ✔ after 0015, 2 documented exceptions |

## Findings fixed (migration `0015_integrity_indexes`)
Before: no index on `sessions.user_id` / `tenant_id`, `portal_sessions.account_id` / `tenant_id`, `notifications.user_id`, `memberships.role_id`, `subscriptions.plan_id`, `billing_invoices.subscription_id` / `plan_id`, `payment_transactions.invoice_id`, `subscription_events.subscription_id`, `leads.owner_id`, `internal_tasks.assignee_id`.
Impact: password reset / logout-everywhere (`DELETE … WHERE user_id = ?`) and every cascading delete of a user, tenant, plan or subscription scanned the whole table. 13 indexes added; `schema.ts` and the drizzle snapshots (0013–0015) were updated to match.

## Deliberate exceptions (not defects)
* `counters` and `role_permissions` have no primary key but a composite UNIQUE index (`counters_uq`, `role_perm_uq`) that enforces identity.
* Global (platform-level) tables have no `tenant_id` by design: `tenants`, `users`, `plans`, `products`, `add_ons`, `platform_settings`, `platform_staff`, `webhook_events`, `leads`, `internal_tasks`.
* Not indexed on purpose (rare lookups): `internal_tasks.created_by`, `tenant_add_ons.add_on_key`.

## Not covered by this audit (be honest)
* Product records share one `records` table with JSON `data`; integrity there (references, uniqueness, immutability) is enforced in the service layer and covered by the product test suites, not by SQL constraints (see ARCHITECTURE.md §5).
* Query plans (`EXPLAIN`) under realistic data volume were not measured. SQLite single-writer limits apply (see DEPLOYMENT.md).
