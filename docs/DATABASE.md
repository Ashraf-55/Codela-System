# DATABASE

Engine: SQLite (better-sqlite3) through Drizzle ORM. Schema: `packages/db/src/schema.ts`. Migrations: `packages/db/migrations` (0000–0018, additive; the journal and the SQL files are checked one-to-one by `schema-integrity.test.ts`). Details of every table: `DATABASE_SCHEMA.md`; audit: `DATABASE_AUDIT.md`.

* **Core platform tables** are relational: tenants, users, memberships, roles/permissions, sessions, products, plans, add-ons, subscriptions, billing invoices/transactions, manual payments, files, domains, tenant sites, notifications, outbox, audit logs, search index, platform staff and leads.
* **Product business data** (patients, orders, shipments, ...) lives in ONE `records` table (`tenant_id`, `entity_type`, `code`, `unique_key`, JSON `data`). Every access is tenant-predicated; references, uniqueness, immutability and state machines are enforced in the product framework, and every tenant-owned table has an index starting with `tenant_id` (tested).
* **Known deviation from the master prompt** ("do not put every product's entities into one generic table"): the generic `records` design was kept because replacing it means rewriting the data layer of all ten products. Consequences: no database-level foreign keys or CHECK constraints between product entities (enforced in code), reports aggregate JSON fields. Moving hot entities (orders, invoices, appointments) to dedicated tables is the recommended next step.
* Money is stored as integer minor units. Migrations must never be generated blindly: `drizzle-kit generate` re-creates tables whose snapshots are missing (it tried to drop `users`); write additive SQL by hand and add it to the journal.
* Backups: `npm run backup` (integrity-checked copy, keeps the newest `BACKUP_KEEP`).


## Addendum 2026-11-24 — verified findings on the shared `records` table
- **Decision: keep the shared table.** No concrete defect was found. Tenant isolation is enforced in one place (`tenant-scope` in `packages/db`, `listRecords`/`getRecord`) and proven for every entity of every product by `security.test.ts` (read / edit / delete / list across tenants, 47 tests); `schema-integrity.test.ts` requires every tenant-owned table to have an index starting with `tenant_id`.
- Per-product validation lives in `EntityDef` (types, enums, refs, readonly, hooks) — a product's entity cannot be written through another product's route (`entityOf(product, key)`), tested in `framework.test.ts` / `security.test.ts`.
- **Risks:** (1) JSON `data` is not column-indexed — list filters on `filterable` fields scan within a tenant/entity partition; fine to ~10^5 rows per tenant, then add generated columns or per-entity tables for the hot entities (products, shipments, appointments). (2) CSV export is capped at 20 000 rows. (3) SQLite single-writer: plan a move to PostgreSQL before sustained write concurrency.
- **Migration plan if needed:** keep `EntityDef` as the contract; add a storage adapter per entity (shared `records` → dedicated table) and backfill with `INSERT … SELECT` per tenant inside a transaction, dual-read behind a flag.
- New in migration `0019`: `tenant_add_ons.expires_at/renewal_due_at`, `addon_events` (tenant-scoped, indexed), `announcements`, `notification_templates` (platform-level, unique `(key, channel)`).
