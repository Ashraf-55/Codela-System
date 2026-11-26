# DEPLOYMENT

## Local
```powershell
npm ci
copy .env.example .env            # edit; apps/web may use apps/web/.env.local
$env:ADMIN_EMAIL="you@codela.tech"; $env:ADMIN_PASSWORD="<strong password>"; npm run create-admin
npm run dev:api                   # http://localhost:4000   (terminal 1)
npm run dev:web                   # http://localhost:3000   (terminal 2)
```
Tenant sites in development: `http://localhost:3000/sites/<slug>` (preview) — wildcard hosts need DNS (e.g. `*.localtest.me` with `ROOT_DOMAIN=localtest.me`, `WEB_HOSTS=localhost`).

## Production checklist
1. `NODE_ENV=production`, `CSRF_SECRET` (≥ 32 random chars), `TRUST_PROXY=loopback` (Next.js and the API on the same host; a hop count or proxy CIDRs otherwise — `true`/`*` are rejected), `WEB_TRUST_PROXY_HOPS=1` when one reverse proxy (Caddy/nginx/Cloudflare) fronts Next.js, `ROOT_DOMAIN=<your root>`, `DATABASE_FILE` on a persistent volume; **do not** set `PAYMENT_PROVIDER=sandbox`.
2. Build/run: `npm run build` then `npm run start:api` and `npm run start:web` (two processes; the API must NOT be exposed publicly — only the Next app is; set `API_URL=http://127.0.0.1:4000`).
3. Reverse proxy (Caddy/nginx/Cloudflare) terminating TLS for the apex **and** `*.<ROOT_DOMAIN>`; forward the original `Host` to Next.
4. **Custom domains + SSL**: the app verifies ownership by DNS TXT and routes verified hosts, but it does **not** issue certificates. Use Caddy on-demand TLS (ask endpoint = `GET /api/v1/public/site` for the host) or Cloudflare for SaaS; tenants point a CNAME/A record at your edge.
5. Backups: SQLite file + WAL (`sqlite3 .backup` or Litestream). Restore-test them.
6. Observability: API logs to stdout (add a log shipper); `GET /api/v1/health` for probes.
7. Before real customers: integrate a payment provider (Paymob needs account, API key, integration ids, HMAC secret and a real webhook implementation), an SMS/WhatsApp/email provider (`NotificationProvider`), a CSP header, self-hosted fonts, account recovery/MFA.

## SQLite limitations
Single writer (WAL allows concurrent readers); long write transactions block others; one node only (no horizontal scaling); `LIKE`-based search is fine for thousands of rows per tenant but should move to FTS5/PostgreSQL beyond that. The data layer is isolated behind Drizzle so migrating to PostgreSQL = new dialect + regenerate migrations + move hot `records` entities into typed tables.
