import { describe, expect, it } from 'vitest';
import { resolvePalette } from '../../src/engines/palette-engine';
import { RuleDomain, type RuleId } from '../../src/shared/domain-model';
import { colorId, constraint, input } from './fixtures';

describe('Palette lock and resolved constraints', () => {
  it('locked selection never gains colors', () => {
    const result = resolvePalette(
      input({
        constraints: [
          constraint({ lockedTo: [colorId('white'), colorId('black'), colorId('navy')] }),
        ],
      }),
    );
    expect(result.ok && result.value.colorIds).toEqual([colorId('black'), colorId('white')]);
  });

  it('intersects multiple locks deterministically', () => {
    const result = resolvePalette(
      input({
        selection: {
          colorIds: [colorId('white'), colorId('black'), colorId('navy')],
          locked: true,
        },
        constraints: [
          constraint({ bucketKey: 'b', lockedTo: [colorId('white'), colorId('black')] }),
          constraint({ bucketKey: 'a', lockedTo: [colorId('black'), colorId('navy')] }),
        ],
      }),
    );
    expect(result.ok && result.value.colorIds).toEqual([colorId('black')]);
  });

  it('forbids/excludes exact IDs', () => {
    const result = resolvePalette(
      input({ constraints: [constraint({ target: 'white', forbidden: true })] }),
    );
    expect(result.ok && result.value.colorIds).toEqual([colorId('black')]);
  });

  it('does not reintroduce a forbidden color through a later lock', () => {
    const result = resolvePalette(
      input({
        constraints: [
          constraint({ bucketKey: 'a', target: 'white', forbidden: true }),
          constraint({ bucketKey: 'b', lockedTo: [colorId('white'), colorId('black')] }),
        ],
      }),
    );
    expect(result.ok && result.value.colorIds).toEqual([colorId('black')]);
  });

  it('blocks an empty final set', () => {
    const result = resolvePalette(
      input({
        constraints: [
          constraint({ target: 'white', forbidden: true }),
          constraint({ target: 'black', forbidden: true }),
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe('RULE_PAL_003');
  });

  it('blocks a required color absent from the resolved set', () => {
    const result = resolvePalette(
      input({ constraints: [constraint({ target: 'navy', required: true })] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe('RULE_PAL_001');
  });

  it('accepts a required color already present without adding anything', () => {
    const result = resolvePalette(
      input({ constraints: [constraint({ target: 'white', required: true })] }),
    );
    expect(result.ok && result.value.colorIds).toEqual([colorId('black'), colorId('white')]);
  });

  it('ignores unrelated domains', () => {
    const result = resolvePalette(
      input({
        constraints: [constraint({ domain: RuleDomain.Decor, target: 'white', forbidden: true })],
      }),
    );
    expect(result.ok && result.value.colorIds).toEqual([colorId('black'), colorId('white')]);
  });

  it('keeps the palette unchanged when a GarmentColor constraint is present', () => {
    const result = resolvePalette(
      input({
        requestedGarmentColorId: colorId('white'),
        constraints: [
          constraint({
            domain: RuleDomain.GarmentColor,
            lockedTo: [colorId('white')],
            winningRuleIds: ['garment-lock' as RuleId],
          }),
        ],
      }),
    );
    expect(result.ok && result.value.colorIds).toEqual([colorId('black'), colorId('white')]);
    if (result.ok) {
      expect(result.value.garmentColorAllowed).toBe(true);
      expect(result.value.diagnostics[0]?.domain).toBe('garment_color');
    }
  });

  it('rejects malformed palette constraints but ignores unrelated malformed semantics', () => {
    const malformed = constraint({ limit: 2 });
    expect(resolvePalette(input({ constraints: [malformed] })).ok).toBe(false);
    const unrelated = constraint({ domain: RuleDomain.Decor, limit: 2 });
    expect(resolvePalette(input({ constraints: [unrelated] })).ok).toBe(true);
  });
});
