# Multi-tenancy

The authoritative description is `docs/TENANT_ARCHITECTURE.md`; this page is the short version required by the project brief.

* One database, one shared platform, many tenants. Every tenant-owned row carries `tenant_id`; every query is tenant-predicated.
* Authenticated requests take the tenant from the session joined to an active membership. A tenant id in a header, body or query is ignored.
* Public requests resolve the tenant from the Host (`<slug>.<ROOT_DOMAIN>` or a verified custom domain). Previews use `/sites/<slug>`.
* References between records are validated inside the same tenant; files, search index, reports and portal sessions are tenant-scoped too.
* Verification: `apps/api/test/security.test.ts` creates a record of every creatable entity of every product in tenant A and proves tenant B cannot read, list, edit or delete it. Per-product tests repeat this for the public routes.
* Not covered by a real-browser or penetration test.
