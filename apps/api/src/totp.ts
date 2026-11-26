import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) — compatible with Google Authenticator, Microsoft Authenticator, Authy, 1Password... */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;
export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/=+$/, '').replace(/\s+/g, ''); let bits = 0, value = 0; const out: number[] = [];
  for (const c of clean) { const i = B32.indexOf(c); if (i < 0) throw new Error('Invalid base32'); value = (value << 5) | i; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export const newTotpSecret = () => base32Encode(randomBytes(20));
export function totpAt(secret: string, step: number, digits = 6): string {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest(); const o = h[h.length - 1] & 15;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 10 ** digits).padStart(digits, '0');
}
/** Accepts the current step ±1 (clock drift). Returns the matched step, or null. `lastStep` blocks replay of a code that was already used. */
export function verifyTotp(secret: string, code: string, now = Date.now(), lastStep: number | null = null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const cur = Math.floor(now / 1000 / STEP_SECONDS);
  for (const step of [cur, cur - 1, cur + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    const want = Buffer.from(totpAt(secret, step)), got = Buffer.from(code);
    if (want.length === got.length && timingSafeEqual(want, got)) return step;
  }
  return null;
}
export const otpauthUrl = (account: string, secret: string, issuer = 'Codela') => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

/** Account lock-out policy: after MAX_FAILURES consecutive failures the account is locked for LOCK_MINUTES. */
export const MAX_FAILURES = 5, LOCK_MINUTES = 15;
export const isLocked = (lockedUntil: string | null | undefined, now = new Date()) => !!lockedUntil && lockedUntil > now.toISOString();
export function nextFailureState(failed: number, now = new Date()): { failedLogins: number; lockedUntil: string | null } {
  const n = failed + 1; return n >= MAX_FAILURES ? { failedLogins: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString() } : { failedLogins: n, lockedUntil: null };
}
