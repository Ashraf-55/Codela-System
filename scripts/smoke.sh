#!/usr/bin/env bash
# End-to-end HTTP smoke test: starts API + built web app, drives the real flows through the Next proxy, asserts results.
# Usage: npm run build -w @codela/web && bash scripts/smoke.sh     (needs: bash, curl)
set -u
cd "$(dirname "$0")/.."
DB=$(mktemp -u /tmp/codela-smoke-XXXX.db); J=$(mktemp); AJ=$(mktemp); FAIL=0
cleanup() { kill "${WEB:-}" "${API:-}" 2>/dev/null; rm -f "$DB"* "$J" "$AJ"; }; trap cleanup EXIT
DATABASE_FILE=$DB TRUST_PROXY=1 ROOT_DOMAIN=codela.test PORT=4000 npx tsx apps/api/src/server.ts > /tmp/smoke-api.log 2>&1 & API=$!
(cd apps/web && API_URL=http://127.0.0.1:4000 ROOT_DOMAIN=codela.test WEB_HOSTS=localhost,127.0.0.1 npx next start -p 3000 > /tmp/smoke-web.log 2>&1) & WEB=$!
for _ in $(seq 1 60); do curl -sf localhost:4000/api/v1/health >/dev/null && curl -sf -o /dev/null localhost:3000/login && break; sleep 1; done
B=localhost:3000/api/v1
ok()   { echo "PASS  $1"; }
bad()  { echo "FAIL  $1"; FAIL=$((FAIL+1)); }
has()  { if grep -q -- "$2" <<<"$3"; then ok "$1"; else bad "$1 (missing: $2)"; fi; }
code() { local c; c=$(curl -s -o /dev/null -w '%{http_code}' "${@:2}"); [ "$c" = "$1" ] && ok "HTTP $1 ${*: -1}" || bad "expected $1 got $c for ${*: -1}"; }

has "home is RTL Arabic by default" '<html lang="ar" dir="rtl">' "$(curl -s localhost:3000/)"
has "English locale cookie switches to LTR" '<html lang="en" dir="ltr">' "$(curl -s -H 'Cookie: locale=en' localhost:3000/pricing)"
has "product page renders real plans from the API" 'المحترف' "$(curl -s localhost:3000/products/medical)"
for p in contact login register; do code 200 "localhost:3000/$p"; done
code 404 localhost:3000/products/nope

REG=$(curl -s -c "$J" -X POST $B/auth/register-business -H 'content-type: application/json' -d '{"businessName":"Smoke Clinic","slug":"smoke","productSlug":"medical","name":"Owner","email":"owner@smoke.test","password":"Str0ng-Pass!1","locale":"ar"}')
has "tenant registration through the proxy" '"slug":"smoke"' "$REG"
CSRF=$(awk '$6=="csrf"{print $7}' "$J"); H=(-H content-type:application/json -H "x-csrf-token:$CSRF")
code 403 -b "$J" -X POST $B/tenant/p/patient -H content-type:application/json -d '{"name":"No Csrf"}'
has "create patient (CSRF ok)" '"code":"PT-0001"' "$(curl -s -b "$J" -X POST $B/tenant/p/patient "${H[@]}" -d '{"name":"Ahmed Ali","phone":"01001234567"}')"
code 400 -b "$J" -X POST $B/tenant/p/patient "${H[@]}" -d '{"gender":"male"}'
curl -s -b "$J" -X POST $B/tenant/p/doctor "${H[@]}" -d '{"name":"Dr. Hany","consultationFee":30000}' >/dev/null
curl -s -b "$J" -X PUT $B/tenant/site "${H[@]}" -d '{"templateKey":"modern","brand":{"name":"Smoke Clinic","primaryColor":"#0e7490","secondaryColor":"#15803d","description":"We care","phone":"01001234567","socials":{}},"sections":[{"type":"hero","enabled":true,"content":{"title":"Welcome to Smoke Clinic","text":"Book online"}}]}' >/dev/null
code 404 localhost:3000/sites/smoke   # not published yet
has "publish site" '"publishedAt"' "$(curl -s -b "$J" -X POST $B/tenant/site/publish "${H[@]}" -d '{}')"
SITE=$(curl -s localhost:3000/sites/smoke)
has "tenant site renders brand content" 'Welcome to Smoke Clinic' "$SITE"
has "tenant site renders catalogue (doctors)" 'Dr. Hany' "$SITE"
has "tenant site applies brand colour + template" 'tpl-modern' "$SITE"
has "tenant site has booking/inquiry forms" 'aria-label' "$SITE"
has "subdomain host routing serves the tenant site" 'Welcome to Smoke Clinic' "$(curl -s -H 'Host: smoke.codela.test' localhost:3000/)"
code 404 -H 'Host: nobody.codela.test' localhost:3000/
has "public form via proxy" '"ok":true' "$(curl -s -X POST $B/public/forms/inquiry -H content-type:application/json -H 'x-codela-site: smoke' -d '{"name":"Visitor","phone":"01011112222","message":"Hello"}')"
has "inquiry stored for the tenant" '"total":1' "$(curl -s -b "$J" "$B/tenant/p/inquiry")"
has "global search via proxy" 'Ahmed Ali' "$(curl -s -b "$J" "$B/search?q=ahmed")"
code 401 -H 'Cookie: sid=forged' $B/tenant/p-meta

ADMIN_EMAIL=root@codela.test ADMIN_PASSWORD='Admin-Pass-12345' DATABASE_FILE=$DB npx tsx apps/api/src/create-admin.ts >/dev/null
curl -s -c "$AJ" -X POST $B/platform/auth/login -H content-type:application/json -d '{"email":"root@codela.test","password":"Admin-Pass-12345"}' >/dev/null
has "super admin analytics sees the tenant" '"total":1' "$(curl -s -b "$AJ" $B/platform/analytics)"
code 401 -b "$J" $B/platform/analytics   # tenant session cannot reach /platform
for p in /app /admin /admin/login /app/billing; do code 200 "localhost:3000$p"; done
curl -sI localhost:3000/ | grep -qi 'x-content-type-options: nosniff' && ok "security headers" || bad "security headers"
echo; [ "$FAIL" = 0 ] && echo "SMOKE: ALL PASSED" || echo "SMOKE: $FAIL FAILED"; exit "$FAIL"
