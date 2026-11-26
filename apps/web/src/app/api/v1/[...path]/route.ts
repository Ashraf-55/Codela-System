import { type NextRequest } from 'next/server';
import { API_URL, ROOT_DOMAIN } from '@/lib/server-api';
import { clientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';
const FORWARD = ['cookie', 'range', 'content-type', 'x-csrf-token', 'x-file-name', 'user-agent', 'accept-language'];
// Response headers that must survive the proxy: file downloads rely on them (attachment name, sandboxing CSP, no-sniff, caching rules).
const PASS_BACK = ['content-type', 'content-range', 'accept-ranges', 'content-disposition', 'content-security-policy', 'x-content-type-options', 'cross-origin-resource-policy', 'cache-control'];
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = `${API_URL}/api/v1/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
  const headers = new Headers();
  for (const k of FORWARD) { const v = req.headers.get(k); if (v) headers.set(k, v); }
  // Tenant selection for public site calls: explicit preview slug, otherwise the browser's own host (custom domain / subdomain).
  const site = req.headers.get('x-codela-site') ?? req.nextUrl.searchParams.get('site'); // the query form exists for <img src> (cannot send headers); the slug is validated below
  headers.set('x-forwarded-host', site && SLUG.test(site) ? `${site}.${ROOT_DOMAIN}` : req.headers.get('host') ?? '');
  // Never relay the browser's own X-Forwarded-For: send exactly one value derived from the trusted proxy chain (or none).
  const ip = clientIp(req.headers.get('x-forwarded-for'));
  if (ip) headers.set('x-forwarded-for', ip);
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const r = await fetch(url, { method: req.method, headers, body: hasBody ? await req.arrayBuffer() : undefined, redirect: 'manual', cache: 'no-store' }).catch(() => null);
  if (!r) return Response.json({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'The service is temporarily unavailable' } }, { status: 503 });
  const out = new Headers(); for (const k of PASS_BACK) { const v = r.headers.get(k); if (v) out.set(k, v); }
  const len = r.headers.get('content-length'); if (len && !r.headers.get('content-encoding')) out.set('content-length', len); // lets <video> know the size (and range responses stay exact)
  for (const c of r.headers.getSetCookie()) out.append('set-cookie', c);
  return new Response(r.body, { status: r.status, headers: out });
}
export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
