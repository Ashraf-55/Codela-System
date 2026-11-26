import { describe, expect, it } from 'vitest';
import { clientIp, proxyHops } from '../src/lib/client-ip';

describe('clientIp (trusted proxy chain)', () => {
  it('ignores X-Forwarded-For entirely when no proxy is configured', () => { expect(clientIp('1.2.3.4', 0)).toBeNull(); expect(proxyHops(undefined)).toBe(0); });
  it('takes the entry added by the single trusted proxy, not the forged left-most one', () => { expect(clientIp('6.6.6.6, 198.51.100.7', 1)).toBe('198.51.100.7'); });
  it('counts hops from the right with a multi-proxy chain', () => { expect(clientIp('6.6.6.6, 198.51.100.7, 10.0.0.2', 2)).toBe('198.51.100.7'); });
  it('rejects garbage and missing values', () => { expect(clientIp('<script>', 1)).toBeNull(); expect(clientIp(null, 1)).toBeNull(); expect(clientIp('1.1.1.1', 3)).toBeNull(); });
  it('clamps WEB_TRUST_PROXY_HOPS', () => { expect(proxyHops('abc')).toBe(0); expect(proxyHops('-4')).toBe(0); expect(proxyHops('99')).toBe(10); expect(proxyHops('1')).toBe(1); });
});
