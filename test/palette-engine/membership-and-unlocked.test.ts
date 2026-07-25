import { describe, expect, it } from 'vitest';
import { resolvePalette } from '../../src/engines/palette-engine';
import { colorId, constraint, input } from './fixtures';

describe('garment color membership and unlocked semantics', () => {
  it('returns true for a selected allowed color', () => {
    const result = resolvePalette(input({ requestedGarmentColorId: colorId('white') }));
    expect(result.ok && result.value.garmentColorAllowed).toBe(true);
  });

  it('blocks a known color outside a locked selection', () => {
    const result = resolvePalette(input({ requestedGarmentColorId: colorId('navy') }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe('RULE_PAL_001');
  });

  it('returns false without substitution when unlocked and requested color is not selected', () => {
    const result = resolvePalette(
      input({
        selection: { colorIds: [colorId('white')], locked: false },
        requestedGarmentColorId: colorId('navy'),
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.colorIds).toEqual([colorId('white')]);
      expect(result.value.garmentColorAllowed).toBe(false);
    }
  });

  it('does not treat unlocked as all library colors', () => {
    const result = resolvePalette(
      input({ selection: { colorIds: [colorId('sand')], locked: false } }),
    );
    expect(result.ok && result.value.colorIds).toEqual([colorId('sand')]);
  });

  it('rejects unknown requested color', () => {
    const result = resolvePalette(input({ requestedGarmentColorId: colorId('unknown') }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe('PE_INTERNAL_LIBRARY');
  });

  it('a constraint-excluded requested color blocks when locked', () => {
    const result = resolvePalette(
      input({
        requestedGarmentColorId: colorId('white'),
        constraints: [constraint({ target: 'white', forbidden: true })],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe('RULE_PAL_001');
  });
});
