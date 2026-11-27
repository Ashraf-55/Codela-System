import { describe, it, expect } from 'vitest';
import { addPeriod, startTrial, applyEvent, tick, accessLevel, type Sub } from '../src/subscription';

const d = (s: string) => new Date(s);
const base = (over: Partial<Sub> = {}): Sub => ({
  status: 'active', billingPeriod: 'monthly', trialEndsAt: null,
  currentPeriodStart: '2026-01-31T00:00:00.000Z', currentPeriodEnd: '2026-02-28T00:00:00.000Z',
  graceEndsAt: null, cancelAtPeriodEnd: false, canceledAt: null, ...over });

describe('addPeriod', () => {
  it('monthly clamps month end', () => expect(addPeriod(d('2026-01-31T00:00:00Z'), 'monthly').toISOString()).toBe('2026-02-28T00:00:00.000Z'));
  it('monthly leap year', () => expect(addPeriod(d('2028-01-31T00:00:00Z'), 'monthly').toISOString()).toBe('2028-02-29T00:00:00.000Z'));
  it('annual from Feb 29 -> Feb 28', () => expect(addPeriod(d('2028-02-29T00:00:00Z'), 'annual').toISOString()).toBe('2029-02-28T00:00:00.000Z'));
});

describe('trial', () => {
  it('startTrial', () => {
    const s = startTrial(d('2026-03-01T00:00:00Z'), 14, 'monthly');
    expect(s.status).toBe('trialing'); expect(s.trialEndsAt).toBe('2026-03-15T00:00:00.000Z');
  });
  it('trial expires on tick', () => {
    const s = startTrial(d('2026-03-01T00:00:00Z'), 14, 'monthly');
    expect(tick(s, d('2026-03-14T23:59:59Z'), 7).status).toBe('trialing');
    expect(tick(s, d('2026-03-15T00:00:00Z'), 7).status).toBe('expired');
  });
  it('trial -> active on payment', () => {
    const s = startTrial(d('2026-03-01T00:00:00Z'), 14, 'monthly');
    const a = applyEvent(s, { type: 'payment_succeeded' }, d('2026-03-05T00:00:00Z'));
    expect(a.status).toBe('active'); expect(a.currentPeriodStart).toBe('2026-03-05T00:00:00.000Z'); expect(a.currentPeriodEnd).toBe('2026-04-05T00:00:00.000Z');
  });
});

describe('renewal, grace, suspension', () => {
  it('active renews on payment_succeeded (extends from period end)', () => {
    const a = applyEvent(base(), { type: 'payment_succeeded' }, d('2026-02-27T00:00:00Z'));
    expect(a.status).toBe('active'); expect(a.currentPeriodEnd).toBe('2026-03-28T00:00:00.000Z');
  });
  it('period end without payment -> past_due with grace', () => {
    const s = tick(base(), d('2026-02-28T00:00:00Z'), 7);
    expect(s.status).toBe('past_due'); expect(s.graceEndsAt).toBe('2026-03-07T00:00:00.000Z');
  });
  it('grace ends -> suspended', () => {
    const pd = tick(base(), d('2026-02-28T00:00:00Z'), 7);
    expect(tick(pd, d('2026-03-06T23:59:59Z'), 7).status).toBe('past_due');
    expect(tick(pd, d('2026-03-07T00:00:00Z'), 7).status).toBe('suspended');
  });
  it('payment during grace restores active', () => {
    const pd = tick(base(), d('2026-02-28T00:00:00Z'), 7);
    const a = applyEvent(pd, { type: 'payment_succeeded' }, d('2026-03-02T00:00:00Z'));
    expect(a.status).toBe('active'); expect(a.graceEndsAt).toBeNull();
  });
  it('payment_failed on active -> past_due', () => {
    expect(applyEvent(base(), { type: 'payment_failed' }, d('2026-02-10T00:00:00Z'), 7).status).toBe('past_due');
  });
  it('suspended -> reactivate on payment', () => {
    const s = base({ status: 'suspended' });
    expect(applyEvent(s, { type: 'payment_succeeded' }, d('2026-04-01T00:00:00Z')).status).toBe('active');
  });
});

describe('cancel', () => {
  it('cancel at period end keeps access until end then canceled', () => {
    const c = applyEvent(base(), { type: 'cancel', atPeriodEnd: true }, d('2026-02-10T00:00:00Z'));
    expect(c.status).toBe('active'); expect(c.cancelAtPeriodEnd).toBe(true);
    expect(tick(c, d('2026-02-28T00:00:00Z'), 7).status).toBe('canceled');
  });
  it('immediate cancel', () => {
    const c = applyEvent(base(), { type: 'cancel', atPeriodEnd: false }, d('2026-02-10T00:00:00Z'));
    expect(c.status).toBe('canceled'); expect(c.canceledAt).toBe('2026-02-10T00:00:00.000Z');
  });
  it('canceled can resubscribe via payment', () => {
    const c = base({ status: 'canceled' });
    expect(applyEvent(c, { type: 'payment_succeeded' }, d('2026-05-01T00:00:00Z')).status).toBe('active');
  });
  it('invalid: cancel when already expired', () => {
    expect(() => applyEvent(base({ status: 'expired' }), { type: 'cancel', atPeriodEnd: true }, d('2026-05-01T00:00:00Z'))).toThrow();
  });
});

describe('access policy (data is never deleted)', () => {
  it('maps status to access', () => {
    expect(accessLevel('trialing')).toBe('full'); expect(accessLevel('active')).toBe('full'); expect(accessLevel('past_due')).toBe('full');
    for (const s of ['suspended', 'expired', 'canceled'] as const) expect(accessLevel(s)).toBe('read_only');
  });
});

describe('tick: catches up on every transition that is due (no stale full-access window)', () => {
  const base = { billingPeriod: 'monthly' as const, trialEndsAt: null, graceEndsAt: null, cancelAtPeriodEnd: false, canceledAt: null };
  it('an active subscription last seen before period end AND grace end is suspended in one step', () => {
    const sub = { ...base, status: 'active' as const, currentPeriodStart: '2026-01-01T00:00:00.000Z', currentPeriodEnd: '2026-02-01T00:00:00.000Z' };
    const out = tick(sub, new Date('2026-03-15T00:00:00.000Z'), 7);
    expect(out.status).toBe('suspended');
    expect(accessLevel(out.status)).toBe('read_only');
  });
  it('still stops at past_due while inside the grace window', () => {
    const sub = { ...base, status: 'active' as const, currentPeriodStart: '2026-01-01T00:00:00.000Z', currentPeriodEnd: '2026-02-01T00:00:00.000Z' };
    expect(tick(sub, new Date('2026-02-03T00:00:00.000Z'), 7).status).toBe('past_due');
  });
});
