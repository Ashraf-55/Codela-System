# Super Admin completion report

Date: 2026-11-24 · `npm run check` ✅ (60 files / 510 tests, build ✅). Browser: **not run**.

| Capability | Status | Backend | Screen | Tests |
|---|---|---|---|---|
| Tenants list / search / suspend / activate | Implemented (earlier) | ✅ | `/admin/tenants` | ✅ |
| **Customer detail**: subscription, history, payments, add-ons, activity | Implemented | `GET /platform/tenants/:id/{subscription-history,payments,addons,activity}` | `/admin/tenants/[id]` | ✅ |
| **Manual activate / renew / cancel** (reason required, state machine, audited, owner notified) | Implemented | `POST /platform/tenants/:id/subscription/:action` (`plans.manage`) | detail page | ✅ |
| Plans, payments review (InstaPay / Vodafone Cash) | Implemented (earlier) | ✅ | `/admin/plans`, `/admin/payments` | ✅ |
| **Add-ons management** (CRUD, price, billing type, products, grants, enable/disable) | Screen added (API existed) | ✅ | `/admin/addons` | API ✅ |
| **Announcements** (CRUD, enable/disable, product targeting, date window; shown in owner dashboard) | Implemented | `/platform/announcements`, `/tenant/announcements` | `/admin/announcements` | ✅ |
| **Notification templates** (edit ar/en, channel, preview, variable validation, restore built-in; used by the outbox) | Implemented | `/platform/notification-templates` | `/admin/templates` | ✅ |
| **System settings** (payment instructions, company, support contacts) | Screen added (API existed) | `/platform/settings/:key` | `/admin/settings` | API ✅ |
| CSV exports (tenants, payments): `reports.export`, audited, formula-safe | Implemented | `/platform/exports/*.csv` | buttons on tenants | ✅ |
| Add-on monthly lifecycle (renewal due, expire, grace, history) | Implemented | job + `addon_events` | owner billing page shows state | ✅ fake clock |

Permissions: support is read-only; `settings.manage` (announcements, templates) is Super Admin only; `plans.manage` (manual subscription) finance + Super Admin; `reports.export` finance + Super Admin. Tenant users cannot reach `/platform/*` (tested).
Not done: per-product reports export beyond tenants/payments; template editing for tenant-level (owner) messages; platform user management screen.
