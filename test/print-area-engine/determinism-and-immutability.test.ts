import { describe, expect, it } from 'vitest';
import { measurePrintArea } from '../../src/engines/print-area-engine';
import { PrintAreaObstruction } from '../../src/shared/domain-model';
import { deepFreeze, input } from './fixtures';

describe('Print-Area determinism and immutability', () => {
  it('is byte-identical across repeated runs and overlap permutations', () => {
    const first = measurePrintArea(
      input({
        observation: {
          overlaps: [PrintAreaObstruction.Shadows, PrintAreaObstruction.Hands],
          sizeRatio: 0.5,
          centeringOffset: 0.02,
          shadowCoverage: 0.03,
        },
      }),
    );
    const second = measurePrintArea(
      input({
        observation: {
          overlaps: [PrintAreaObstruction.Hands, PrintAreaObstruction.Shadows],
          sizeRatio: 0.5,
          centeringOffset: 0.02,
          shadowCoverage: 0.03,
        },
      }),
    );
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('does not mutate deeply frozen inputs on success', () => {
    const frozen = deepFreeze(input());
    expect(() => measurePrintArea(frozen)).not.toThrow();
  });

  it('does not mutate deeply frozen inputs on failure', () => {
    const frozen = deepFreeze(input({ requestedPosition: 'center_back' }));
    expect(() => measurePrintArea(frozen)).not.toThrow();
  });

  it('cloned semantic input produces identical output', () => {
    const original = input();
    const cloned = structuredClone(original) as typeof original;
    expect(JSON.stringify(measurePrintArea(original))).toBe(
      JSON.stringify(measurePrintArea(cloned)),
    );
  });
});
