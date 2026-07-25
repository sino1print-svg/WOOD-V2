import { describe, expect, it } from 'vitest';
import { measurePrintArea } from '../../src/engines/print-area-engine';
import { input } from './fixtures';

describe('Print-Area security guards', () => {
  it('rejects cyclic runtime input without stack overflow', () => {
    const value = input() as unknown as Record<string, unknown>;
    value.self = value;
    const result = measurePrintArea(value as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe('PA_INTERNAL_CYCLE');
  });

  it('rejects dangerous own keys', () => {
    const value = input() as unknown as Record<string, unknown>;
    Object.defineProperty(value, 'constructor', { value: 'hostile', enumerable: true });
    const result = measurePrintArea(value as never);
    expect(result.ok).toBe(false);
  });

  it('rejects sparse overlap arrays', () => {
    const overlaps = new Array(2) as never[];
    overlaps[1] = 'hands' as never;
    const result = measurePrintArea(
      input({ observation: { overlaps, sizeRatio: 1, centeringOffset: 0, shadowCoverage: 0 } }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects excessive overlap arrays', () => {
    const overlaps = Array.from({ length: 1001 }, () => 'hands' as never);
    const result = measurePrintArea(
      input({ observation: { overlaps, sizeRatio: 1, centeringOffset: 0, shadowCoverage: 0 } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe('PA_INTERNAL_LIMIT');
  });
});
