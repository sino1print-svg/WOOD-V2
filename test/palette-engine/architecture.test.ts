import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}

describe('Palette Engine architecture boundaries', () => {
  const sources = files('src/engines/palette-engine');
  const joined = sources.map((file) => readFileSync(file, 'utf8')).join('\n');

  it('does not import another engine implementation', () => {
    expect(joined).not.toMatch(
      /from ['"][^'"]*engines\/(rule|scene|print-area|dedup|validation|prompt|cover|export)-engine/,
    );
  });

  it('does not import UI, persistence implementation, Asset Store or Orchestrator', () => {
    expect(joined).not.toMatch(/from ['"][^'"]*(ui|persistence|asset-store|orchestrator)/);
  });

  it('exports a public resolve function', async () => {
    const module = await import('../../src/engines/palette-engine');
    expect(typeof module.resolvePalette).toBe('function');
  });
});

describe('Palette Engine stage ordering architecture regression', () => {
  const engineSource = readFileSync('src/engines/palette-engine/engine.ts', 'utf8');

  it('resolves Palette before validating GarmentColor', () => {
    const stageOneCall = engineSource.indexOf('const paletteStage = resolvePaletteStage(input)');
    const stageTwoCall = engineSource.indexOf('const garmentStage = validateGarmentColorStage(');
    expect(stageOneCall).toBeGreaterThan(-1);
    expect(stageTwoCall).toBeGreaterThan(stageOneCall);
  });

  it('filters Palette and GarmentColor constraints in separate stages', () => {
    expect(engineSource).toContain(
      'input.constraints.filter((item) => item.domain === RuleDomain.Palette)',
    );
    expect(engineSource).toContain(
      'constraints.filter((item) => item.domain === RuleDomain.GarmentColor)',
    );
    expect(engineSource).not.toMatch(
      /item\.domain === RuleDomain\.Palette\s*\|\|\s*item\.domain === RuleDomain\.GarmentColor/,
    );
  });

  it('passes a readonly ResolvedPalette into GarmentColor validation', () => {
    expect(engineSource).toContain('palette: Readonly<ResolvedPalette>');
    expect(engineSource).not.toMatch(/palette\.colorIds\s*=/);
    expect(engineSource).not.toMatch(
      /palette\.colorIds\.(push|pop|splice|sort|reverse|shift|unshift)\(/,
    );
  });
});
