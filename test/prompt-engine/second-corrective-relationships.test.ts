import { describe, expect, it } from 'vitest';
import { composeOutputA, composeOutputB } from '../../src/engines/prompt-engine';
import { deepFreeze, inputA, inputB } from './fixtures';

describe('Prompt Engine second corrective — centralized relationships', () => {
  it('rejects Output A garment identity mismatches', () => {
    const base = inputA();
    const result = composeOutputA({
      ...base,
      scene: {
        ...base.scene,
        outputA: { ...base.scene.outputA, garment: 'totally-different-product' },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0]?.field).toBe('scene.outputA.garment');
  });

  it('rejects sourceHash independently from sourceContentHash', () => {
    const base = inputB();
    const result = composeOutputB({
      ...base,
      scene: {
        ...base.scene,
        outputB: { ...base.scene.outputB!, sourceHash: 'one-character-different' as never },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0]?.field).toBe('scene.outputB.sourceHash');
  });

  it('rejects sourceContentHash independently when sourceHash matches', () => {
    const base = inputB();
    const result = composeOutputB({
      ...base,
      scene: {
        ...base.scene,
        outputB: { ...base.scene.outputB!, sourceContentHash: 'different-content-hash' as never },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0]?.field).toBe('scene.outputB.sourceContentHash');
  });

  it('accepts frozen and cloned valid relationships without mutation', () => {
    const frozen = deepFreeze(inputB());
    const before = JSON.stringify(frozen);
    const first = composeOutputB(frozen);
    const second = composeOutputB(structuredClone(inputB()));
    expect(first.ok && second.ok).toBe(true);
    expect(JSON.stringify(frozen)).toBe(before);
    if (!first.ok || !second.ok) return;
    expect(first.value.promptText).toBe(second.value.promptText);
    expect(first.value.promptHash).toBe(second.value.promptHash);
  });
});
