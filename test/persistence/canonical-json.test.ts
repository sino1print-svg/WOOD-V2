import { describe, expect, it } from 'vitest';
import { canonicalStringify, deterministicContentHash, safeJsonParse } from '../../src/persistence';

describe('canonical project serialization', () => {
  it('sorts object keys recursively while preserving array order', () => {
    const result = canonicalStringify({ z: 1, a: { y: 2, x: 3 }, list: ['b', 'a'] });
    expect(result).toEqual({ ok: true, value: '{"a":{"x":3,"y":2},"list":["b","a"],"z":1}' });
  });

  it('omits undefined object properties and normalizes negative zero', () => {
    const result = canonicalStringify({ b: undefined, a: -0 });
    expect(result).toEqual({ ok: true, value: '{"a":0}' });
  });

  it('rejects raw bytes and cyclic structures', () => {
    expect(canonicalStringify({ bytes: new Uint8Array([1]) }).ok).toBe(false);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(canonicalStringify(cyclic).ok).toBe(false);
  });

  it('safe parse rejects prototype-pollution keys', () => {
    const result = safeJsonParse('{"__proto__":{"polluted":true}}');
    expect(result.ok).toBe(false);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('content hashes exclude timestamps but include ordinary content', async () => {
    const left = await deterministicContentHash({ name: 'A', updatedAt: '2026-01-01' });
    const right = await deterministicContentHash({ name: 'A', updatedAt: '2027-01-01' });
    const changed = await deterministicContentHash({ name: 'B', updatedAt: '2027-01-01' });
    expect(left.ok && right.ok && left.value).toBe(right.ok ? right.value : '');
    expect(left.ok && changed.ok && left.value).not.toBe(changed.ok ? changed.value : '');
  });
});
