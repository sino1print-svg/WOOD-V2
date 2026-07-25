import { describe, expect, it } from 'vitest';
import { measurePrintArea } from '../../src/engines/print-area-engine';
import { input, product, profile } from './fixtures';

const unknownFields = [
  ['unexpected', true],
  ['minSizeRato', 0.5],
  ['centeredFlag', true],
  ['forbiddenOverlap', []],
  ['legacyField', 'value'],
] as const;

describe('PrintAreaProfile exact shape', () => {
  it.each(unknownFields)('rejects unknown own property %s', (key, value) => {
    const p = { ...profile(), [key]: value };
    const result = measurePrintArea(input({ profile: p as never }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.field).toBe(`profile.${key}`);
    expect(Object.prototype.hasOwnProperty.call(p, key)).toBe(true);
  });

  it('rejects symbol and non-enumerable unknown properties', () => {
    const symbolProfile = profile() as unknown as Record<PropertyKey, unknown>;
    symbolProfile[Symbol('unknown')] = true;
    expect(measurePrintArea(input({ profile: symbolProfile as never })).ok).toBe(false);

    const hidden = profile() as unknown as Record<string, unknown>;
    Object.defineProperty(hidden, 'hiddenUnknown', { value: true, enumerable: false });
    expect(measurePrintArea(input({ profile: hidden as never })).ok).toBe(false);
  });

  it.each(['__proto__', 'constructor', 'prototype'])('rejects dangerous own key %s', (key) => {
    const p = profile() as unknown as Record<string, unknown>;
    Object.defineProperty(p, key, { value: 'unsafe', enumerable: true, configurable: true });
    expect(measurePrintArea(input({ profile: p as never })).ok).toBe(false);
  });

  it('rejects an unknown getter without executing it', () => {
    let calls = 0;
    const p = profile() as unknown as Record<string, unknown>;
    Object.defineProperty(p, 'unknownGetter', {
      enumerable: true,
      get() {
        calls += 1;
        return true;
      },
    });
    expect(measurePrintArea(input({ profile: p as never })).ok).toBe(false);
    expect(calls).toBe(0);
  });

  it('accepts equivalent profiles regardless of object property order', () => {
    const source = profile();
    const reordered = {
      forbiddenOverlaps: source.forbiddenOverlaps,
      maxShadowCoverage: source.maxShadowCoverage,
      centered: source.centered,
      centeringTolerance: source.centeringTolerance,
      minSizeRatio: source.minSizeRatio,
      position: source.position,
      id: source.id,
    };
    expect(
      measurePrintArea(
        input({ profile: reordered, product: product({ printAreaProfile: source }) }),
      ).ok,
    ).toBe(true);
  });
});
