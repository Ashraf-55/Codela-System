import { describe, it, expect } from 'vitest';
import { toMinor, fromMinor, addMoney, applyBasisPoints, formatMoney, minorDigits } from '../src/money';

describe('money (integer minor units)', () => {
  it('digits per currency', () => {
    expect(minorDigits('EGP')).toBe(2); expect(minorDigits('KWD')).toBe(3); expect(minorDigits('JPY')).toBe(0);
  });
  it('toMinor avoids float error', () => {
    expect(toMinor('0.1', 'EGP') + toMinor('0.2', 'EGP')).toBe(30);
    expect(toMinor('19.99', 'SAR')).toBe(1999);
    expect(toMinor('1.234', 'KWD')).toBe(1234);
  });
  it('toMinor rejects too many decimals and junk', () => {
    expect(() => toMinor('1.234', 'EGP')).toThrow();
    expect(() => toMinor('abc', 'EGP')).toThrow();
  });
  it('fromMinor', () => { expect(fromMinor(1999, 'SAR')).toBe('19.99'); expect(fromMinor(5, 'KWD')).toBe('0.005'); });
  it('addMoney requires same currency', () => {
    expect(addMoney({ amount: 100, currency: 'EGP' }, { amount: 50, currency: 'EGP' })).toEqual({ amount: 150, currency: 'EGP' });
    expect(() => addMoney({ amount: 1, currency: 'EGP' }, { amount: 1, currency: 'SAR' })).toThrow();
  });
  it('tax in basis points rounds half up, integer only', () => {
    expect(applyBasisPoints(10000, 1400)).toBe(1400); // 14% of 100.00
    expect(applyBasisPoints(1999, 1500)).toBe(300);   // 299.85 -> 300
    expect(Number.isInteger(applyBasisPoints(333, 1400))).toBe(true);
  });
  it('rejects non-integer amounts', () => { expect(() => applyBasisPoints(1.5, 100)).toThrow(); });
  it('formatMoney', () => { expect(formatMoney({ amount: 123456, currency: 'EGP' }, 'en')).toContain('1,234.56'); });
});
