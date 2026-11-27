# Deploying on Hostinger (Business / Cloud "Web Apps")

One web app runs everything. `scripts/start-all.mjs` listens immediately (Hostinger requires the entry process itself to call `listen()` within 3 s), serves the website in-process (Next.js custom server) and runs the API as a private child bound to 127.0.0.1 on a port the OS picks (PORT=0), which the API reports back over IPC — the entry process opens no other socket, because Hostinger captures listen() calls made there. The API exits if its parent dies. Node runs Next.js and tsx directly (Hostinger starts apps without `npm` on PATH).

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
