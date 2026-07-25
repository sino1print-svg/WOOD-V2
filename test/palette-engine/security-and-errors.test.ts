import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolvePalette } from '../../src/engines/palette-engine';
import { ERROR_BY_CODE } from '../../src/shared/errors';
import { colorId, input } from './fixtures';

describe('Palette Engine security and errors', () => {
  it('rejects cyclic runtime input', () => {
    const base = input() as unknown as Record<string, unknown>;
    base.self = base;
    expect(resolvePalette(base as never).ok).toBe(false);
  });

  it('returns a structured failure for malformed arrays instead of throwing', () => {
    const malformed = { ...input(), constraints: null } as never;
    expect(() => resolvePalette(malformed)).not.toThrow();
    expect(resolvePalette(malformed).ok).toBe(false);
  });

  it('enforces configured array limits', () => {
    const result = resolvePalette(input(), {
      maxColors: 1,
      maxPalettes: 1,
      maxConstraints: 1,
      maxIdLength: 512,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe('PE_INTERNAL_LIMIT');
  });

  it('authoritative palette errors have meaningful bilingual messages', () => {
    for (const code of ['RULE_PAL_001', 'RULE_PAL_002', 'RULE_PAL_003']) {
      expect(ERROR_BY_CODE[code]?.messageAr.length).toBeGreaterThan(5);
      expect(ERROR_BY_CODE[code]?.messageEn.length).toBeGreaterThan(5);
    }
  });

  it('production source has no clocks, randomness, eval, Function constructor, network or filesystem', () => {
    const files = ['engine.ts', 'validation.ts', 'set-operations.ts', 'failures.ts', 'types.ts'];
    const source = files
      .map((file) => readFileSync(`src/engines/palette-engine/${file}`, 'utf8'))
      .join('\n');
    expect(source).not.toMatch(
      /Date\.now|new Date|performance\.now|Math\.random|\beval\s*\(|new Function|node:fs|node:http|fetch\s*\(/,
    );
  });

  it('description text cannot affect palette behavior because raw Rules are not an input', () => {
    const source =
      readFileSync('src/engines/palette-engine/types.ts', 'utf8') +
      readFileSync('src/engines/palette-engine/engine.ts', 'utf8');
    expect(source).not.toContain('Rule.description');
    expect(source).not.toMatch(/description/i);
  });

  it('rejects oversized IDs before library lookup', () => {
    const result = resolvePalette(
      input({ selection: { colorIds: [colorId('x'.repeat(513))], locked: true } }),
    );
    expect(result.ok).toBe(false);
  });
});
