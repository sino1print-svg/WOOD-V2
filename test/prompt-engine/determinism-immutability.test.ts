import { describe, expect, it } from 'vitest';
import { composeOutputA, composeOutputB } from '../../src/engines/prompt-engine';
import { deepFreeze, inputA, inputB } from './fixtures';

describe('Prompt Engine determinism and immutability', () => {
  it('is byte deterministic across repeated, frozen and cloned inputs', () => {
    const frozen = deepFreeze(inputA());
    const one = composeOutputA(frozen);
    const two = composeOutputA(frozen);
    const three = composeOutputA(structuredClone(frozen));
    expect(one).toEqual(two);
    expect(two).toEqual(three);
  });

  it('ignores object key insertion order', () => {
    const input = inputA();
    const reordered = Object.fromEntries(
      Object.entries(input).reverse(),
    ) as unknown as typeof input;
    expect(composeOutputA(reordered)).toEqual(composeOutputA(input));
  });

  it('canonicalizes semantically unordered custom notes', () => {
    const a = composeOutputA({
      ...inputA(),
      customNotes: ['second note', 'first note', 'first note'],
    });
    const b = composeOutputA({ ...inputA(), customNotes: ['first note', 'second note'] });
    expect(a).toEqual(b);
  });

  it('does not mutate input and artwork hash affects only B checksum material', () => {
    const input = inputB();
    const before = structuredClone(input);
    const result = composeOutputB(input);
    expect(input).toEqual(before);
    expect(result.ok).toBe(true);
    const changed = composeOutputB({
      ...input,
      artwork: {
        ...input.artwork,
        contentHash: 'changed-hash' as typeof input.artwork.contentHash,
      },
    });
    expect(changed.ok).toBe(true);
    if (result.ok && changed.ok) {
      expect(changed.value.promptText).toBe(result.value.promptText);
      expect(changed.value.promptMeta.promptChecksum).not.toBe(
        result.value.promptMeta.promptChecksum,
      );
    }
  });
});
