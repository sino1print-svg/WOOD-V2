import { describe, expect, it } from 'vitest';
import { measurePrintArea } from '../../src/engines/print-area-engine';
import { input, product, profile } from './fixtures';

describe('Print Area public API adversarial regression', () => {
  it.each([
    profile({ minSizeRatio: 1.1 }),
    profile({ centeringTolerance: 2 }),
    profile({ maxShadowCoverage: 999 }),
    { ...profile(), unexpected: true },
    profile({ centered: new Boolean(true) as never }),
    profile({ minSizeRatio: new Number(0.5) as never }),
  ])('returns a structured deterministic failure for malformed profile %#', (malformed) => {
    const first = measurePrintArea(
      input({ profile: malformed as never, product: product({ printAreaProfile: profile() }) }),
    );
    const second = measurePrintArea(
      input({ profile: malformed as never, product: product({ printAreaProfile: profile() }) }),
    );
    expect(first.ok).toBe(false);
    expect(second).toEqual(first);
  });

  it('rejects sparse and oversized arrays without throwing', () => {
    const sparse = new Array(2);
    sparse[1] = 'hands';
    const oversized = Array.from({ length: 1001 }, () => 'hands');
    for (const overlaps of [sparse, oversized]) {
      expect(() =>
        measurePrintArea(input({ profile: profile({ forbiddenOverlaps: overlaps as never }) })),
      ).not.toThrow();
      expect(
        measurePrintArea(input({ profile: profile({ forbiddenOverlaps: overlaps as never }) })).ok,
      ).toBe(false);
    }
  });

  it('rejects cycles and leaves frozen malformed data unchanged', () => {
    const cyclic = profile() as unknown as Record<string, unknown>;
    cyclic.self = cyclic;
    expect(measurePrintArea(input({ profile: cyclic as never })).ok).toBe(false);

    const frozen = Object.freeze({ ...profile(), minSizeRatio: 2 });
    const keys = Reflect.ownKeys(frozen);
    expect(measurePrintArea(input({ profile: frozen as never })).ok).toBe(false);
    expect(Reflect.ownKeys(frozen)).toEqual(keys);
  });
});
