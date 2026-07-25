import { describe, expect, it } from 'vitest';
import { resolvePalette } from '../../src/engines/palette-engine';
import { colorId, input } from './fixtures';

describe('Palette Engine contract and color validation', () => {
  it('returns normalized selected colors in bytewise order', () => {
    const result = resolvePalette(
      input({ selection: { colorIds: [colorId('white'), colorId('black')], locked: true } }),
    );
    expect(result).toEqual({
      ok: true,
      value: {
        colorIds: [colorId('black'), colorId('white')],
        locked: true,
        paletteId: null,
        garmentColorAllowed: null,
        diagnostics: [],
      },
    });
  });

  it('normalizes duplicate IDs without mutating the source', () => {
    const selected = [colorId('white'), colorId('white'), colorId('black')];
    const result = resolvePalette(input({ selection: { colorIds: selected, locked: true } }));
    expect(result.ok && result.value.colorIds).toEqual([colorId('black'), colorId('white')]);
    expect(selected).toEqual([colorId('white'), colorId('white'), colorId('black')]);
  });

  it('rejects an empty selection with the authoritative code', () => {
    const result = resolvePalette(input({ selection: { colorIds: [], locked: true } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe('RULE_PAL_003');
  });

  it('rejects unknown selected colors', () => {
    const result = resolvePalette(
      input({ selection: { colorIds: [colorId('unknown')], locked: true } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe('PE_INTERNAL_LIBRARY');
  });

  it.each(['', '\u0000bad', '__proto__', 'constructor'])('rejects malformed color ID %j', (id) => {
    const result = resolvePalette(input({ selection: { colorIds: [colorId(id)], locked: true } }));
    expect(result.ok).toBe(false);
  });

  it('rejects duplicate library IDs', () => {
    const base = input();
    const result = resolvePalette({
      ...base,
      library: { ...base.library, colors: [...base.library.colors, base.library.colors[0]!] },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown selected palette ID', () => {
    const result = resolvePalette(
      input({
        selection: {
          colorIds: [colorId('white')],
          locked: true,
          paletteId: 'missing-palette' as never,
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe('PE_INTERNAL_LIBRARY');
  });

  it('rejects malformed locked discriminant', () => {
    const malformed = input({
      selection: { colorIds: [colorId('white')], locked: 'true' as unknown as boolean },
    });
    expect(resolvePalette(malformed).ok).toBe(false);
  });
});
