import { describe, expect, it } from 'vitest';
import { composeOutputB } from '../../src/engines/prompt-engine';
import { deepFreeze, inputB } from './fixtures';

describe('Prompt Engine corrective — Output B source relationships', () => {
  it.each([
    ['sourceOutputAId', 'wrong-a'],
    ['sceneId', 'wrong-scene'],
    ['sourceContentHash', 'wrong-hash'],
    ['artworkId', 'wrong-art'],
  ])('rejects mismatched %s', (field, value) => {
    const base = inputB();
    const scene = { ...base.scene, outputB: { ...base.scene.outputB!, [field]: value } };
    expect(composeOutputB({ ...base, scene: scene as never }).ok).toBe(false);
  });

  it('rejects missing Output B and malformed Output A source identity', () => {
    const base = inputB();
    expect(composeOutputB({ ...base, scene: { ...base.scene, outputB: null } }).ok).toBe(false);
    expect(
      composeOutputB({
        ...base,
        scene: { ...base.scene, outputA: { ...base.scene.outputA, color: 'black' } } as never,
      }).ok,
    ).toBe(false);
  });

  it('accepts frozen, cloned and key-reordered equivalent pairs deterministically', () => {
    const frozen = deepFreeze(inputB());
    const a = composeOutputB(frozen);
    const b = composeOutputB(structuredClone(inputB()));
    const original = inputB();
    const reordered = {
      artwork: original.artwork,
      artworkAttached: original.artworkAttached,
      sourceImageAttached: original.sourceImageAttached,
      outputNumber: original.outputNumber,
      customNotes: original.customNotes,
      constraints: original.constraints,
      generatedAt: original.generatedAt,
      versions: original.versions,
      resolved: original.resolved,
      selectedColorIds: original.selectedColorIds,
      season: original.season,
      product: original.product,
      scene: original.scene,
    };
    const c = composeOutputB(reordered);
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (!a.ok || !b.ok || !c.ok) return;
    expect(a.value.promptText).toBe(b.value.promptText);
    expect(a.value.promptText).toBe(c.value.promptText);
    expect(a.value.promptHash).toBe(c.value.promptHash);
  });
});
