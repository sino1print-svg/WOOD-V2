import { describe, expect, it } from 'vitest';
import { resolvePalette } from '../../src/engines/palette-engine';
import { canonicalStringify } from '../../src/persistence/shared/canonical-json';
import { RuleDomain } from '../../src/shared/domain-model';
import { colorId, constraint, deepFreeze, input } from './fixtures';

function serialized(value: unknown): string {
  const result = canonicalStringify(value);
  if (!result.ok) throw new Error(result.error.messageEn);
  return result.value;
}

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length <= 1) return [[...values]];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, i) => i !== index)).map((rest) => [value, ...rest]),
  );
}

describe('Palette Engine determinism and immutability', () => {
  it('is invariant to selected color permutations', () => {
    const outputs = permutations([colorId('white'), colorId('black'), colorId('navy')]).map((ids) =>
      serialized(resolvePalette(input({ selection: { colorIds: ids, locked: true } }))),
    );
    expect(new Set(outputs).size).toBe(1);
  });

  it('is invariant to constraint order permutations', () => {
    const constraints = [
      constraint({ bucketKey: 'lock', lockedTo: [colorId('white'), colorId('black')] }),
      constraint({ bucketKey: 'forbid', target: 'white', forbidden: true }),
      constraint({
        bucketKey: 'unrelated',
        domain: RuleDomain.Decor,
        target: 'red',
        forbidden: true,
      }),
    ];
    const outputs = permutations(constraints).map((items) =>
      serialized(resolvePalette(input({ constraints: items }))),
    );
    expect(new Set(outputs).size).toBe(1);
  });

  it('is invariant to palette manifest entry order', () => {
    const base = input();
    const forward = resolvePalette(base);
    const reversed = resolvePalette({
      ...base,
      library: {
        colors: [...base.library.colors].reverse(),
        palettes: [...base.library.palettes].reverse(),
      },
    });
    expect(serialized(forward)).toBe(serialized(reversed));
  });

  it('produces byte-identical repeated and cloned results', () => {
    const base = input({ constraints: [constraint({ lockedTo: [colorId('white')] })] });
    const one = serialized(resolvePalette(base));
    const two = serialized(resolvePalette(structuredClone(base)));
    expect(one).toBe(two);
  });

  it('does not mutate deeply frozen inputs', () => {
    const frozen = deepFreeze(
      input({ constraints: [constraint({ lockedTo: [colorId('white')] })] }),
    );
    expect(() => resolvePalette(frozen)).not.toThrow();
  });
});
