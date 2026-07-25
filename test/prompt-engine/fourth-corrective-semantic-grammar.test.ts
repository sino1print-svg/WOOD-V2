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

const exactSceneBypasses = [
  'Decor on garment.',
  'Pumpkins on garment.',
  'Halloween decor on garment.',
  'Candles on garment.',
] as const;

const sceneSubjects = [
  'decor',
  'pumpkins',
  'candles',
  'props',
  'background',
  'backdrop',
  'scene',
] as const;
const relations = ['on', 'onto', 'across', 'over', 'upon'] as const;
const garmentObjects = ['garment', 'shirt', 'tee', 'chest', 'product'] as const;
const generatedAttacks = sceneSubjects.flatMap((subject) =>
  relations.flatMap((relation) =>
    garmentObjects.map((object) => `${subject} ${relation} ${object}`),
  ),
);

describe('Phase 5 fourth corrective — grammar-level semantic relationships', () => {
  it.each(exactSceneBypasses)('drops reproduced Scene→Garment conflict: %s', (attack) => {
    const mixed = `Warm rustic studio background with soft lighting. ${attack}`;
    const ordinary = composeOutputA(withScene(mixed));
    const frozen = composeOutputA(deepFreeze(withScene(mixed)));
    const cloned = composeOutputA(structuredClone(withScene(mixed)));
    expect(ordinary).toEqual(frozen);
    expect(frozen).toEqual(cloned);
    expect(ordinary.ok).toBe(true);
    if (!ordinary.ok) return;
    expect(ordinary.value.promptText).toContain(
      'Warm rustic studio background with soft lighting.',
    );
    expect(ordinary.value.promptText.toLowerCase()).not.toContain(attack.toLowerCase());
    expect(ordinary.value.promptText).toContain('The garment must be completely blank');
  });

  it('drops Garment→BlankState negation', () => {
    const mixed = 'A classic crew neck garment with natural cotton drape. Garment without blank.';
    const result = composeOutputA(withProduct(mixed));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.promptText).toContain(
      'A classic crew neck garment with natural cotton drape.',
    );
    expect(result.value.promptText).not.toContain('Garment without blank');
  });

  it.each(generatedAttacks)('blocks generated semantic relationship attack: %s', (attack) => {
    const result = composeOutputA(withScene(attack));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0]?.field).toBe('resolved.sceneDescription');
  });

  it.each([
    'A blank classic crew neck tee with natural cotton drape.',
    'Rustic studio background with pumpkins and candles behind the garment.',
    'Warm beige walls with soft natural lighting.',
  ])('retains valid descriptive grammar: %s', (text) => {
    const result = text.startsWith('A blank')
      ? composeOutputA(withProduct(text))
      : composeOutputA(withScene(text));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.promptText).toContain(text);
  });
});
