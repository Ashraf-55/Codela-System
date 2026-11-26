export type Currency = string;
export interface Money { amount: number; currency: Currency }

const DIGITS: Record<string, number> = { EGP: 2, SAR: 2, AED: 2, USD: 2, EUR: 2, QAR: 2, KWD: 3, BHD: 3, OMR: 3, JPY: 0 };

export function minorDigits(currency: Currency): number {
  return DIGITS[currency.toUpperCase()] ?? 2;
}

/** Parse a decimal string into integer minor units without floating point. */
export function toMinor(value: string, currency: Currency): number {
  const d = minorDigits(currency);
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw new Error(`Invalid money value: ${value}`);
  const frac = m[3] ?? '';
  if (frac.length > d) throw new Error(`Too many decimals for ${currency}: ${value}`);
  const n = Number(m[2] + frac.padEnd(d, '0'));
  if (!Number.isSafeInteger(n)) throw new Error('Amount too large');
  return m[1] ? -n : n;
}

export function fromMinor(amount: number, currency: Currency): string {
  assertInt(amount);
  const d = minorDigits(currency);
  const neg = amount < 0;
  const s = String(Math.abs(amount)).padStart(d + 1, '0');
  const out = d === 0 ? s : `${s.slice(0, -d)}.${s.slice(-d)}`;
  return neg ? `-${out}` : out;
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new Error('Currency mismatch');
  assertInt(a.amount); assertInt(b.amount);
  return { amount: a.amount + b.amount, currency: a.currency };
}

/** Percentage in basis points (1400 = 14%), rounded half up, integer math only. */
export function applyBasisPoints(amount: number, bp: number): number {
  assertInt(amount); assertInt(bp);
  const sign = amount < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(amount) * bp + 5000) / 10000);
}

export function formatMoney(m: Money, locale: string): string {
  const d = minorDigits(m.currency);
  const [whole, frac] = fromMinor(m.amount, m.currency).split('.');
  const grouped = new Intl.NumberFormat(locale).format(BigInt(whole));
  return `${grouped}${frac ? '.' + frac : ''} ${m.currency}`.replace(/\s+/, d >= 0 ? ' ' : ' ');
}

function assertInt(n: number) {
  if (!Number.isInteger(n)) throw new Error(`Money amount must be an integer minor unit: ${n}`);
}
