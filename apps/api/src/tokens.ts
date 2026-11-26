import { createHmac, timingSafeEqual } from 'node:crypto';

/** Stateless signed tokens (e-mail verification, password reset). Format: base64url("kind|subject|expiresMs|bind").hexHmacSha256. */
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
export function signToken(kind: string, subject: string, ttlMs: number, secret: string, bind = '', now = Date.now()): string {
  if ([kind, subject, bind].some((p) => p.includes('|'))) throw new Error('Token parts must not contain "|"');
  const body = b64(`${kind}|${subject}|${now + ttlMs}|${bind}`);
  return `${body}.${createHmac('sha256', secret).update(body).digest('hex')}`;
}
/** Returns {subject, bind} when the signature is valid, the kind matches and the token has not expired; otherwise null. */
export function verifyToken(token: string, kind: string, secret: string, now = Date.now()): { subject: string; bind: string } | null {
  const [body, sig, ...rest] = String(token).split('.'); if (!body || !sig || rest.length) return null;
  const want = createHmac('sha256', secret).update(body).digest('hex');
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  const [k, subject, exp, bind = ''] = Buffer.from(body, 'base64url').toString('utf8').split('|');
  if (k !== kind || !subject || !(Number(exp) > now)) return null;
  return { subject, bind };
}
