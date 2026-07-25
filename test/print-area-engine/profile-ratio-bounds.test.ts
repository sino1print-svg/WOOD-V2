import { describe, expect, it } from 'vitest';
import { measurePrintArea } from '../../src/engines/print-area-engine';
import { input, product, profile } from './fixtures';

const fields = ['minSizeRatio', 'centeringTolerance', 'maxShadowCoverage'] as const;
const accepted = [0, 0.000001, 0.5, 0.999999, 1];
const rejected: readonly unknown[] = [
  -0.000001,
  -1,
  1.000001,
  1.1,
  2,
  999,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  '0.5',
  '1',
  null,
  undefined,
  {},
  [],
  new Number(0.5),
  1n,
];

describe('PrintAreaProfile ratio bounds', () => {
  for (const field of fields) {
    it.each(accepted)(`accepts ${field}=%p`, (value) => {
      const p = profile({ [field]: value });
      expect(
        measurePrintArea(input({ profile: p, product: product({ printAreaProfile: p }) })).ok,
      ).toBe(true);
    });

    it.each(rejected)(`rejects ${field}=%p`, (value) => {
      const p = profile({ [field]: value } as never);
      const result = measurePrintArea(
        input({ profile: p, product: product({ printAreaProfile: profile() }) }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok && !(value instanceof Number)) {
        expect(result.failures[0]?.field).toBe(`profile.${field}`);
      }
    });
  }

  it('rejects cloned, frozen and reordered malformed profiles without modification', () => {
    const malformed = {
      forbiddenOverlaps: [],
      centered: true,
      maxShadowCoverage: 0.1,
      centeringTolerance: 0.05,
      minSizeRatio: 2,
      position: 'center_chest',
      id: 'pa-profile-tee',
    } as const;
    const values = [structuredClone(malformed), Object.freeze({ ...malformed }), { ...malformed }];
    for (const value of values) {
      const before = Reflect.ownKeys(value);
      const result = measurePrintArea(
        input({ profile: value as never, product: product({ printAreaProfile: profile() }) }),
      );
      expect(result.ok).toBe(false);
      expect(Reflect.ownKeys(value)).toEqual(before);
    }
  });
});
