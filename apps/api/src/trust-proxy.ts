/**
 * Safe Express "trust proxy" configuration.
 *
 * `app.set('trust proxy', true)` makes Express believe the LEFT-most X-Forwarded-For entry, which any client can
 * forge — it lets an attacker pick a fresh "IP" per request and bypass every rate limiter (express-rate-limit
 * reports this as ERR_ERL_PERMISSIVE_TRUST_PROXY). We therefore never accept `true`, `*`, `all` or `0.0.0.0/0`.
 *
 * TRUST_PROXY accepts exactly one of:
 *   - unset / "" / "0" / "false"  -> 'loopback' (secure default: only a proxy on this machine, e.g. the Next.js
 *                                     server on 127.0.0.1, may set X-Forwarded-*; remote clients cannot)
 *   - a positive integer N         -> trust the N closest hops (e.g. 1 = exactly one reverse proxy in front)
 *   - a comma-separated list of IPs / CIDRs / Express keywords (loopback, linklocal, uniquelocal)
 *                                  -> trust only those proxy addresses
 * The legacy value "1" keeps meaning "one hop", so existing .env files keep working.
 */
export type TrustProxySetting = number | string | string[];

const FORBIDDEN = new Set(['true', '*', 'all', '0.0.0.0/0', '::/0']);
const KEYWORDS = new Set(['loopback', 'linklocal', 'uniquelocal']);
const IPV4 = /^(\d{1,3})(\.\d{1,3}){3}(\/(\d|[12]\d|3[0-2]))?$/;
const IPV6 = /^[0-9a-f:]+(%[\w.]+)?(\/(\d{1,2}|1[01]\d|12[0-8]))?$/i;

export function parseTrustProxy(raw: string | undefined): TrustProxySetting {
  const v = (raw ?? '').trim();
  if (v === '' || v === '0' || v.toLowerCase() === 'false') return 'loopback';
  if (FORBIDDEN.has(v.toLowerCase())) {
    throw new Error(`TRUST_PROXY="${v}" is unsafe: it lets clients spoof X-Forwarded-For and bypass rate limiting. Use a hop count (e.g. 1) or a list of proxy IPs/CIDRs.`);
  }
  if (/^\d+$/.test(v)) {
    const n = Number(v);
    if (n > 10) throw new Error(`TRUST_PROXY=${v} is implausibly large; use the exact number of reverse proxies in front of the API.`);
    return n;
  }
  const parts = v.split(',').map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    if (FORBIDDEN.has(p.toLowerCase())) throw new Error(`TRUST_PROXY entry "${p}" is unsafe.`);
    const ok = KEYWORDS.has(p.toLowerCase()) || (IPV4.test(p) && p.split('/')[0].split('.').every((o) => Number(o) <= 255)) || (p.includes(':') && IPV6.test(p));
    if (!ok) throw new Error(`TRUST_PROXY entry "${p}" is not a hop count, IP, CIDR or loopback/linklocal/uniquelocal.`);
  }
  if (parts.length === 0) return 'loopback';
  return parts.length === 1 ? parts[0] : parts;
}
