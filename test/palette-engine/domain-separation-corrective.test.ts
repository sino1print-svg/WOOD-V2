import { describe, expect, it } from 'vitest';
import {
  resolvePalette,
  resolvePaletteStage,
  validateGarmentColorStage,
} from '../../src/engines/palette-engine';
import { RuleDomain, type RuleId } from '../../src/shared/domain-model';
import { canonicalStringify } from '../../src/persistence/shared/canonical-json';
import { colorId, constraint, deepFreeze, input } from './fixtures';

const garmentWhiteOnly = constraint({
  domain: RuleDomain.GarmentColor,
  lockedTo: [colorId('white')],
  winningRuleIds: ['garment-white-only' as RuleId],
});
const paletteWhiteOnly = constraint({
  domain: RuleDomain.Palette,
  lockedTo: [colorId('white')],
  winningRuleIds: ['palette-white-only' as RuleId],
});

describe('Palette/GarmentColor corrective domain separation', () => {
  it('keeps [white, black] and allows requested white under a white-only GarmentColor constraint', () => {
    const result = resolvePalette(
      input({ requestedGarmentColorId: colorId('white'), constraints: [garmentWhiteOnly] }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        colorIds: [colorId('black'), colorId('white')],
        garmentColorAllowed: true,
      },
    });
  });

  it('keeps [white, black] and rejects requested black only at membership stage', () => {
    const result = resolvePalette(
      input({ requestedGarmentColorId: colorId('black'), constraints: [garmentWhiteOnly] }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        colorIds: [colorId('black'), colorId('white')],
        garmentColorAllowed: false,
      },
    });
  });

  it('allows Palette constraints to reduce the resolved palette', () => {
    const result = resolvePalette(input({ constraints: [paletteWhiteOnly] }));
    expect(result.ok && result.value.colorIds).toEqual([colorId('white')]);
  });

  it('allows white when the resolved Palette is white-only', () => {
    const result = resolvePalette(
      input({
        requestedGarmentColorId: colorId('white'),
        constraints: [paletteWhiteOnly],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: { colorIds: [colorId('white')], garmentColorAllowed: true },
    });
  });

  it('rejects black when the resolved Palette is white-only', () => {
    const result = resolvePalette(
      input({
        requestedGarmentColorId: colorId('black'),
        constraints: [paletteWhiteOnly],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe('RULE_PAL_001');
  });

  it('uses palette membership only when no GarmentColor constraint exists', () => {
    const white = resolvePalette(input({ requestedGarmentColorId: colorId('white') }));
    const navy = resolvePalette(
      input({
        selection: { colorIds: [colorId('white')], locked: false },
        requestedGarmentColorId: colorId('navy'),
      }),
    );
    expect(white.ok && white.value.garmentColorAllowed).toBe(true);
    expect(navy.ok && navy.value.garmentColorAllowed).toBe(false);
  });

  it('never lets a GarmentColor constraint rewrite palette colorIds', () => {
    const result = resolvePalette(
      input({
        requestedGarmentColorId: colorId('white'),
        constraints: [
          constraint({
            domain: RuleDomain.GarmentColor,
            target: 'black',
            forbidden: true,
          }),
        ],
      }),
    );
    expect(result.ok && result.value.colorIds).toEqual([colorId('black'), colorId('white')]);
  });

  it('applies multiple GarmentColor constraints only to membership', () => {
    const constraints = [
      garmentWhiteOnly,
      constraint({
        domain: RuleDomain.GarmentColor,
        target: 'white',
        forbidden: true,
        winningRuleIds: ['garment-forbid-white' as RuleId],
      }),
    ];
    const result = resolvePalette(
      input({ requestedGarmentColorId: colorId('white'), constraints }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        colorIds: [colorId('black'), colorId('white')],
        garmentColorAllowed: false,
      },
    });
  });

  it('is invariant to Palette and GarmentColor constraint permutations', () => {
    const constraints = [
      paletteWhiteOnly,
      garmentWhiteOnly,
      constraint({
        domain: RuleDomain.GarmentColor,
        target: 'black',
        forbidden: true,
        winningRuleIds: ['garment-forbid-black' as RuleId],
      }),
    ];
    const forward = resolvePalette(
      input({ requestedGarmentColorId: colorId('white'), constraints }),
    );
    const reverse = resolvePalette(
      input({ requestedGarmentColorId: colorId('white'), constraints: [...constraints].reverse() }),
    );
    expect(canonicalStringify(forward)).toEqual(canonicalStringify(reverse));
  });

  it('preserves deep-frozen inputs and the immutable ResolvedPalette boundary', () => {
    const frozenInput = deepFreeze(
      input({ requestedGarmentColorId: colorId('black'), constraints: [garmentWhiteOnly] }),
    );
    const before = canonicalStringify(frozenInput);
    const stageOne = resolvePaletteStage(frozenInput);
    expect(stageOne.ok).toBe(true);
    if (!stageOne.ok) return;
    const frozenPalette = deepFreeze(stageOne.value);
    const paletteBefore = canonicalStringify(frozenPalette);
    const stageTwo = validateGarmentColorStage(
      frozenPalette,
      colorId('black'),
      frozenInput.constraints,
      frozenInput.selection.locked,
    );
    expect(stageTwo.ok && stageTwo.value.allowed).toBe(false);
    expect(canonicalStringify(frozenInput)).toEqual(before);
    expect(canonicalStringify(frozenPalette)).toEqual(paletteBefore);
  });
});
