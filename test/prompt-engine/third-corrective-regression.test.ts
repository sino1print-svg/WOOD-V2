import { describe, expect, it } from 'vitest';
import { composeOutputA, composeOutputB } from '../../src/engines/prompt-engine';
import { deepFreeze, inputA, inputB } from './fixtures';

describe('Phase 5 third corrective — relationship and Phase 4 regressions', () => {
  it('preserves sourceHash relationship enforcement', () => {
    const base = inputB();
    const result = composeOutputB({
      ...base,
      scene: {
        ...base.scene,
        outputB: { ...base.scene.outputB!, sourceHash: 'mismatch' as never },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0]?.field).toBe('scene.outputB.sourceHash');
  });

  it('preserves Output A garment identity enforcement', () => {
    const base = inputA();
    const result = composeOutputA({
      ...base,
      scene: { ...base.scene, outputA: { ...base.scene.outputA, garment: 'mismatch' } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0]?.field).toBe('scene.outputA.garment');
  });

  it('preserves the Phase 4 obstruction enum contract', () => {
    const base = inputA();
    const result = composeOutputA({
      ...base,
      product: {
        ...base.product,
        printAreaProfile: {
          ...base.product.printAreaProfile,
          forbiddenOverlaps: ['not-an-obstruction'],
        } as never,
      },
    });
    expect(result.ok).toBe(false);
  });

  it('accepts repeated, frozen and cloned relationship-valid inputs byte-identically', () => {
    const frozen = deepFreeze(inputB());
    const first = composeOutputB(frozen);
    const second = composeOutputB(frozen);
    const cloned = composeOutputB(structuredClone(frozen));
    expect(first).toEqual(second);
    expect(second).toEqual(cloned);
    expect(first.ok).toBe(true);
  });
});
