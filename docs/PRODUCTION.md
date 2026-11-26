# Production deployment & operations
**Nothing here has been run on a real server by the author.** Follow it on a staging machine first.

## 1. Topology
Internet → reverse proxy (Caddy/nginx, terminates HTTPS) → Next.js (`:3000`) → API (`127.0.0.1:4000`, never public). Run both on one host.

## 2. Environment (`.env`, see `.env.example`)
`NODE_ENV=production`, `CSRF_SECRET` (≥ 32 random chars), `PAYMENT_PROVIDER=paymob` + Paymob keys, provider keys (Resend/Twilio/WhatsApp), `WEB_HOSTS` (your product domains), `ROOT_DOMAIN`, `API_URL=http://127.0.0.1:4000`.
Proxy trust: API `TRUST_PROXY=loopback` (Next and API on the same host); Web `WEB_TRUST_PROXY_HOPS=1` when exactly one reverse proxy sits in front of Next.js. Wrong values either break rate limiting (all users share one IP) or let clients spoof IPs: test with two different clients.
`PORTAL_REQUIRE_EMAIL_VERIFICATION` must stay on. Persist `DATABASE_FILE` and `UPLOAD_DIR` on a real disk outside the repo/web root.

## 3. HTTPS / domains (Caddy example)
```
codela.example.com, *.codela.example.com {
  reverse_proxy 127.0.0.1:3000
}
```
Wildcard certificates need a DNS-challenge plugin. Tenant custom domains: DNS TXT verification exists in the product, but automatic certificate issuance for them is NOT implemented (use Caddy On-Demand TLS with an `ask` endpoint, or a CDN). Until configured, do not promise customers HTTPS on their own domains.

## 4. Build & run
```
npm ci && npm run check
npm run build
# two supervised processes (systemd/pm2): 
npm run start:api      # API
npm run start:web      # Next.js
```
Health: `GET /api/v1/health` (process) and `GET /api/v1/ready` (database). Point uptime monitoring at `/api/v1/ready`.

## 5. Backups (database + uploads)
`npm run backup` writes a consistent, integrity-checked copy to `data/backups` (keeps `BACKUP_KEEP`=14). Schedule it, e.g. cron `15 2 * * * cd /srv/codela && npm run backup`, then copy `data/backups` AND `UPLOAD_DIR` off the machine (rsync/object storage). **Test a restore**: stop the API, replace `data/codela.db` with a backup, delete `-wal`/`-shm` files, start the API.

## 6. Logging & monitoring
The API logs unhandled errors to stdout (`[api] unhandled error METHOD path message`, no bodies/secrets); collect with journald/pm2 logs. No error-tracking service (Sentry etc.) is integrated; add one if needed.

## 7. Upgrade procedure
Back up → `git pull`/new zip → `npm ci` → `npm run check` → restart API (migrations run on start; they are additive) → restart web.

## 8. Go-live checklist
- [ ] Staging run of `npm run check` and a manual walk-through
- [ ] Paymob sandbox payment end to end (callback URL reachable over HTTPS), then live keys
- [ ] E-mail/SMS/WhatsApp test messages to your own phone/mailbox
- [ ] Backup + restore rehearsal
- [ ] `/api/v1/ready` monitored; disk space alert
- [ ] Super-admin created with a unique strong password

## Account recovery (owners / staff)
`/recover` (web) + `POST /auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, `/auth/resend-verification`. Signed stateless links: reset = 1 hour, single use (bound to the old password hash), revokes every session, clears a lock-out; verification = 24 hours. Always answers identically for unknown accounts. Set `PUBLIC_WEB_URL` so the e-mailed links point at your domain. Platform (Codela staff) accounts have no tenant outbox, so they have NO self-service reset (not implemented): create a replacement super admin with `npm run create-admin` using a new e-mail.

## Error monitoring
Set `SENTRY_DSN` (Sentry, GlitchTip or self-hosted). Without it nothing is sent. The API reports unhandled 5xx errors, `unhandledRejection` and `uncaughtException`; the web app reports server-side render / route-handler errors (`instrumentation.ts`). Only error type, scrubbed message (e-mails, tokens, query strings removed), stack, method and path leave the server — never headers, cookies or bodies. Identical errors are sent at most once a minute, max 30 a minute. This is a small Sentry-protocol client, not the official SDK (no breadcrumbs / traces). Not verified against a live Sentry project.

## Running it (pick one)
* **Docker:** `cp .env.example .env` (fill CSRF_SECRET etc.), `DOMAIN=app.example.com ROOT_DOMAIN=example.com docker compose up -d --build`. Caddy gets HTTPS certificates for `DOMAIN` automatically; tenant subdomains need a wildcard certificate (DNS challenge, see `deploy/Caddyfile`). Data lives in the `codela-data` volume.
* **pm2:** `npm ci && npm run build && pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup`.
* **systemd:** copy `deploy/systemd/*` to `/etc/systemd/system/`, edit `User` / `WorkingDirectory`, `systemctl enable --now codela-api codela-web codela-backup.timer`.
* Always: ONE api instance (SQLite), a reverse proxy in front (`TRUST_PROXY=1`, `WEB_TRUST_PROXY_HOPS=1`), off-machine copies of `data/backups` and `data/uploads`.
* None of these files was executed in the authoring environment (no Docker, no network). Treat the first deployment as the test and read the logs.
