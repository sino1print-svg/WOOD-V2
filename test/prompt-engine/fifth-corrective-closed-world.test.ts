import { describe, expect, it } from 'vitest';
import { composeOutputA } from '../../src/engines/prompt-engine';
import { deepFreeze, inputA } from './fixtures';

function withScene(text: string) {
  const base = inputA();
  return { ...base, resolved: { ...base.resolved, sceneDescription: text } };
}
function withProduct(text: string) {
  const base = inputA();
  return { ...base, resolved: { ...base.resolved, productDescription: text } };
}

const unsupportedSceneRelationships = [
  'decor through garment',
  'decor into garment',
  'decor in garment',
  'pumpkins through garment',
  'pumpkins into garment',
  'pumpkins in garment',
  'candles through garment',
  'garment through decor',
  'garment into background',
  'garment in scene',
  'artwork through scene',
  'scene through artwork',
] as const;

describe('Phase 5 fifth corrective — true closed-world grammar', () => {
  it.each(unsupportedSceneRelationships)('rejects unsupported relationship: %s', (text) => {
    const ordinary = composeOutputA(withScene(text));
    const frozen = composeOutputA(deepFreeze(withScene(text)));
    const cloned = composeOutputA(structuredClone(withScene(text)));
    expect(ordinary).toEqual(frozen);
    expect(frozen).toEqual(cloned);
    expect(ordinary.ok).toBe(false);
    if (ordinary.ok) return;
    expect(ordinary.failures[0]?.field).toBe('resolved.sceneDescription');
  });

  it.each([
    'garment no blank',
    'garment not blank',
    'garment without blank',
    'already printed garment',
    'decorated garment',
    'finished garment with print',
  ])('rejects blank-sale contradiction: %s', (text) => {
    const result = composeOutputA(withProduct(text));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0]?.field).toBe('resolved.productDescription');
  });

  it.each([
    'Rustic studio background with pumpkins and candles behind the garment.',
    'Soft neutral backdrop beside the garment.',
    'Warm studio lighting near the garment.',
  ])('accepts only explicit safe scene spatial references: %s', (text) => {
    const result = composeOutputA(withScene(text));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.promptText).toContain(text);
  });

  it('keeps deterministic, immutable valid output', () => {
    const input = withScene('Warm beige studio background with soft natural lighting.');
    const before = structuredClone(input);
    const first = composeOutputA(input);
    const second = composeOutputA(input);
    const frozen = composeOutputA(deepFreeze(structuredClone(input)));
    expect(first).toEqual(second);
    expect(second).toEqual(frozen);
    expect(input).toEqual(before);
  });
});
