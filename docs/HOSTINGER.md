# Deploying on Hostinger (Business / Cloud "Web Apps")

One web app, **one process**. `scripts/start-all.mjs` listens immediately (Hostinger requires the entry process itself to call `listen()` within 3 s), serves the website in-process (Next.js custom server) and builds the API in-process as well: the website's server-side `fetch()` calls to `http://codela-api.internal` are handed to the API in memory (light-my-request). No internal network is used — on Hostinger, connections between processes on 127.0.0.1 are refused (`ECONNREFUSED`) and `listen()` calls in the entry process are captured.

**Data survives redeploys automatically:** Hostinger puts each deploy in `…/hbuilds/versions/<id>/`; unless `DATABASE_FILE` / `UPLOAD_DIR` are absolute paths, `start-all` keeps them in `…/domains/<domain>/codela-data/`.

## Ship a prebuilt website (shared plans)
Shared hosting caps processes and threads, so `next build` fails there (`spawn node EAGAIN`). Build on a Linux/Windows/macOS machine and commit the result to the deploy branch:

```bash
npm ci
npm run build
git add .
git add -f apps/web/.next ':!apps/web/.next/cache'
git commit -m "deploy: prebuilt website"
git push
```
Rebuild and re-push `apps/web/.next` after every change to `apps/web` or `packages/*`. If `apps/web/.next/BUILD_ID` is missing, `start-all` tries a low-resource build on the server (works on a VPS, usually not on shared plans).

## hPanel settings
| Setting | Value |
|---|---|
| Framework preset | Express |
| Node.js | 22 |
| Entry file | `scripts/start-all.mjs` |
| Domain | `saas.codela.tech` |

## Environment variables
| Name | Value |
|---|---|
| `WEB_HOSTS` | `saas.codela.tech` — **required**: hosts that serve Codela itself; any other host is treated as a customer website |
| `ROOT_DOMAIN` | `saas.codela.tech` |
| `CSRF_SECRET` | 64 random characters (never share) |
| `TRUST_PROXY` | `loopback` |
| `PAYMENT_PROVIDER` | `sandbox` while testing |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | first Super Admin, created on first start only when no admin exists; remove after logging in |

Do **not** set `NODE_ENV` or `PORT` in the panel (`NODE_ENV=production` makes the install skip build tools; `start-all` sets it itself; Hostinger provides `PORT`).

## Limits on shared hosting
* Customer sites open at `https://saas.codela.tech/sites/<business-slug>` (subdomains per customer need wildcard DNS + TLS → VPS).
* SQLite is one file: back up `codela-data/` regularly.
* A VPS avoids all of the above: `docker compose up -d` (`docker-compose.yml`, `deploy/`).
