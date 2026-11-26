import { NextResponse, type NextRequest } from 'next/server';

// Hosts that serve the Codela product itself; every other host is a tenant website (custom domain or <slug>.<ROOT_DOMAIN>).
const MAIN = (process.env.WEB_HOSTS ?? 'localhost,127.0.0.1').split(',').map((h) => h.trim().toLowerCase());
// Opt-in strict Content-Security-Policy with a per-request nonce (CSP_STRICT=1). Scripts may only run if they carry the nonce Next.js adds to its own scripts;
// inline styles stay allowed because the UI uses style attributes. Test every page before enabling it in production.
const STRICT = process.env.CSP_STRICT === '1';
const DEV = process.env.NODE_ENV !== 'production';

function strictCsp(nonce: string): string {
  return ["default-src 'self'", `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${DEV ? " 'unsafe-eval'" : ''}`, "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "img-src 'self' data: blob: https:", "font-src 'self' data: https://fonts.gstatic.com", "frame-src https://www.google.com/maps/",
    `connect-src 'self'${DEV ? ' ws: wss:' : ''}`, "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'"].join('; ');
}

// Next.js 16 renamed the `middleware` file convention to `proxy` (the old name is deprecated and logs a warning).
export function proxy(req: NextRequest) {
  const host = (req.headers.get('host') ?? '').split(':')[0].toLowerCase();
  const p = req.nextUrl.pathname;
  const headers = new Headers(req.headers); let csp = '';
  if (STRICT) { const nonce = btoa(crypto.randomUUID()); csp = strictCsp(nonce); headers.set('x-nonce', nonce); headers.set('content-security-policy', csp); }
  const done = (res: NextResponse) => { if (csp) res.headers.set('content-security-policy', csp); return res; };
  if (MAIN.includes(host) || p.startsWith('/api/') || p.startsWith('/_next') || p.startsWith('/sites/')) return done(NextResponse.next({ request: { headers } }));
  const url = req.nextUrl.clone(); url.pathname = p === '/portal' || p.startsWith('/portal/') || p.startsWith('/doctors/') || p.startsWith('/properties/') || /^\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p) ? `/sites/_host${p}` : '/sites/_host';
  return done(NextResponse.rewrite(url, { request: { headers } }));
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
