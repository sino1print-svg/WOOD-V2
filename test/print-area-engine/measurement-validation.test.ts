import { describe, expect, it } from 'vitest';
import { measurePrintArea, printAreaFailureMessages } from '../../src/engines/print-area-engine';
import { input, profile } from './fixtures';

describe('Print-Area measurement validation', () => {
  for (const [field, observation] of [
    ['sizeRatio', { overlaps: [], sizeRatio: -1, centeringOffset: 0, shadowCoverage: 0 }],
    [
      'centeringOffset',
      { overlaps: [], sizeRatio: 1, centeringOffset: Number.NaN, shadowCoverage: 0 },
    ],
    [
      'shadowCoverage',
      { overlaps: [], sizeRatio: 1, centeringOffset: 0, shadowCoverage: Infinity },
    ],
  ] as const) {
    it(`rejects invalid ${field}`, () => {
      const result = measurePrintArea(input({ observation }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failures[0]?.code).toBe('PA_INTERNAL_MEASUREMENT');
    });
  }

  it('rejects negative zero for canonical numeric output', () => {
    const result = measurePrintArea(
      input({
        observation: { overlaps: [], sizeRatio: -0, centeringOffset: 0, shadowCoverage: 0 },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects malformed obstruction values', () => {
    const result = measurePrintArea(
      input({
        observation: {
          overlaps: ['scene-text' as never],
          sizeRatio: 1,
          centeringOffset: 0,
          shadowCoverage: 0,
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('validates profile thresholds without judging PA-PRED predicates', () => {
    const result = measurePrintArea(input({ profile: profile({ minSizeRatio: -1 }) }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.originEngine).toBe('print_area');
  });

  it('returns meaningful bilingual failure messages', () => {
    const messages = printAreaFailureMessages('PA_INTERNAL_MEASUREMENT');
    expect(messages.ar).toContain('قياس');
    expect(messages.en).toContain('measurement');
  });
});
