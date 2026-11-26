import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('hex');
// Cost 12 always in production; the test suite lowers it (BCRYPT_COST) purely for speed.
const COST = process.env.NODE_ENV === 'production' ? 12 : Math.min(12, Math.max(4, Number(process.env.BCRYPT_COST) || 12));
export const hashPassword = (pw: string) => bcrypt.hash(pw, COST);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);
// Used to equalize timing when the account does not exist.
export const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', COST);

export function csrfFor(sessionToken: string, secret: string): string {
  return createHmac('sha256', secret).update(sessionToken).digest('hex');
}
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
