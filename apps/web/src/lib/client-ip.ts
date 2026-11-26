// Number of reverse proxies (Caddy / nginx / Cloudflare ...) between the internet and this Next.js server. Each one APPENDS the
// address it saw to X-Forwarded-For, so the real client is the Nth entry from the RIGHT; everything left of it is client-supplied and forgeable.
// 0 (default) = Next.js is directly exposed: X-Forwarded-For is ignored entirely and the API rate-limits the shared proxy address (safe, coarse).
const IP_LIKE = /^[0-9a-f.:]{3,45}$/i;
export function proxyHops(env: string | undefined = process.env.WEB_TRUST_PROXY_HOPS): number {
  return Math.min(Math.max(parseInt(env ?? '0', 10) || 0, 0), 10);
}
export function clientIp(xff: string | null, hops: number = proxyHops()): string | null {
  if (!hops || !xff) return null;
  const parts = xff.split(',').map((x) => x.trim()).filter(Boolean);
  const ip = parts[parts.length - hops];
  return ip && IP_LIKE.test(ip) ? ip : null;
}
