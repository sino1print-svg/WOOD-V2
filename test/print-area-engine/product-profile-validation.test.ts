import { describe, expect, it } from 'vitest';
import { measurePrintArea } from '../../src/engines/print-area-engine';
import { input, product, profile } from './fixtures';

describe('product.printAreaProfile validation and equivalence', () => {
  it.each([
    ['centered', 'yes'],
    ['forbiddenOverlaps', ['invalid']],
    ['minSizeRatio', 1.1],
  ] as const)('rejects malformed product profile field %s', (field, value) => {
    const main = profile();
    const nested = profile({ [field]: value } as never);
    const result = measurePrintArea(
      input({ profile: main, product: product({ printAreaProfile: nested }) }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.field).toBe(`product.printAreaProfile.${field}`);
  });

  it('rejects unknown and custom-prototype product profiles', () => {
    const main = profile();
    const unknown = { ...main, unexpected: true };
    expect(
      measurePrintArea(
        input({ profile: main, product: product({ printAreaProfile: unknown as never }) }),
      ).ok,
    ).toBe(false);

    const custom = Object.assign(Object.create({}), main);
    expect(
      measurePrintArea(input({ profile: main, product: product({ printAreaProfile: custom }) })).ok,
    ).toBe(false);
  });

  it('rejects malformed input.profile even when the product profile is valid', () => {
    const valid = profile();
    const malformed = profile({ centered: 'yes' as never });
    const result = measurePrintArea(
      input({ profile: malformed, product: product({ printAreaProfile: valid }) }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.field).toBe('profile.centered');
  });

  it('rejects mismatched IDs and semantically different valid profiles', () => {
    const main = profile();
    const differentId = profile({ id: 'other-profile' as never });
    expect(
      measurePrintArea(
        input({ profile: main, product: product({ printAreaProfile: differentId }) }),
      ).ok,
    ).toBe(false);

    const different = profile({ centered: false });
    expect(
      measurePrintArea(input({ profile: main, product: product({ printAreaProfile: different }) }))
        .ok,
    ).toBe(false);
  });

  it('accepts equivalent independent, cloned, frozen and reordered profiles', () => {
    const main = Object.freeze(profile());
    const clone = structuredClone(main);
    const reordered = {
      forbiddenOverlaps: clone.forbiddenOverlaps,
      maxShadowCoverage: clone.maxShadowCoverage,
      centered: clone.centered,
      centeringTolerance: clone.centeringTolerance,
      minSizeRatio: clone.minSizeRatio,
      position: clone.position,
      id: clone.id,
    };
    const result = measurePrintArea(
      input({ profile: main, product: Object.freeze(product({ printAreaProfile: reordered })) }),
    );
    expect(result.ok).toBe(true);
  });
});
