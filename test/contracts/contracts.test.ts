/**
 * Contracts boundary audit (deterministic).
 * Engine contracts import only the domain model. The contracts layer is TYPE-ONLY:
 * operational Export refinement TYPES live here, but the runtime mapping value lives
 * in the export infrastructure (src/export/format-mapping.ts) — IMPL §3/§5.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p: string): string => readFileSync(path.join(ROOT, p), 'utf8');
const CONTRACTS_DIR = path.join(ROOT, 'src', 'shared', 'contracts');

describe('engine contracts', () => {
  const source = read('src/shared/contracts/engine-contracts.ts');
  it('imports only from the domain model', () => {
    const froms = [...source.matchAll(/from\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const spec of froms) expect(spec).toBe('../domain-model');
  });
  it('contains no implementation (interfaces/types only)', () => {
    expect(source).not.toMatch(/\bfunction\b/);
    expect(source).not.toMatch(/\bclass\b/);
    expect(source).not.toMatch(/=>\s*\{/);
  });
  it('declares the expected engine contracts', () => {
    for (const name of [
      'RuleEngineContract',
      'PaletteEngineContract',
      'PrintAreaEngineContract',
      'DedupEngineContract',
      'SceneEngineContract',
      'ValidationEngineContract',
      'PromptEngineContract',
      'CoverEngineContract',
      'ExportEngineContract',
    ]) {
      expect(source).toContain(`interface ${name}`);
    }
  });
});

describe('shared/contracts is TYPE-ONLY (no runtime values)', () => {
  it('no contracts file declares a runtime export (const/let/var/function/class/enum/default)', () => {
    for (const f of readdirSync(CONTRACTS_DIR).filter((x) => x.endsWith('.ts'))) {
      const src = readFileSync(path.join(CONTRACTS_DIR, f), 'utf8');
      expect(src, `${f} has a runtime export`).not.toMatch(
        /^export\s+(const|let|var|function|class|enum|default)\b/m,
      );
    }
  });
  it('export-refinements keeps only TYPES (ExportDeliveryFormat/Channel)', () => {
    const src = read('src/shared/contracts/export-refinements.ts');
    expect(src).toMatch(/export type ExportDeliveryFormat/);
    expect(src).toMatch(/export type ExportDeliveryChannel/);
    expect(src).not.toContain('PERSISTED_EXPORT_FORMAT');
  });
});

describe('export operational refinement layer (IMPL §5)', () => {
  it('runtime mapping lives in src/export/format-mapping.ts, not in contracts/domain', () => {
    expect(read('src/export/format-mapping.ts')).toMatch(/export const PERSISTED_EXPORT_FORMAT/);
    expect(read('src/shared/domain-model/export-manifest.ts')).not.toContain(
      'ExportDeliveryFormat',
    );
  });
  it('domain ExportManifest.exportFormats uses the persisted ExportFormat only', () => {
    expect(read('src/shared/domain-model/export-manifest.ts')).toMatch(
      /exportFormats:\s*readonly ExportFormat\[\]/,
    );
  });
  it('persisted ExportFormat enum is not widened', () => {
    const enums = read('src/shared/domain-model/enums.ts');
    const block = enums.slice(enums.indexOf('export enum ExportFormat'));
    const body = block.slice(0, block.indexOf('}'));
    expect(body).not.toContain('clipboard');
    expect(body).not.toContain('markdown');
  });
});
