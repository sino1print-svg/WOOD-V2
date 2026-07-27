import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAYER_ROOTS, checkAllowedTargets, checkEngineMatrix, scan } from '../../architecture/scan';

const PACKAGING_ROOT = path.join(LAYER_ROOTS.export, 'packaging');
const { edges, unresolvedInternal } = scan();
const packagingFiles = readdirSync(PACKAGING_ROOT)
  .filter((name) => name.endsWith('.ts'))
  .sort();
const packagingSource = packagingFiles
  .map((name) => readFileSync(path.join(PACKAGING_ROOT, name), 'utf8'))
  .join('\n');

describe('Batch 10.4 packaging architecture (EX section 7)', () => {
  it('resolves every internal dependency', () => {
    expect(
      unresolvedInternal.filter((ref) => ref.from.startsWith(`${PACKAGING_ROOT}${path.sep}`)),
    ).toEqual([]);
  });

  it('imports only shared contracts, config, the Batch 10.3 formatter layer, and its own modules', () => {
    expect(
      checkAllowedTargets(edges, PACKAGING_ROOT, [
        LAYER_ROOTS.shared,
        LAYER_ROOTS.config,
        LAYER_ROOTS.export,
      ]),
    ).toEqual([]);
  });

  it('imports no engine implementation', () => {
    expect(
      checkEngineMatrix(
        edges.filter(
          (edge) =>
            edge.from === PACKAGING_ROOT || edge.from.startsWith(`${PACKAGING_ROOT}${path.sep}`),
        ),
      ),
    ).toEqual([]);
  });

  it('imports no UI, persistence, or application module', () => {
    expect(packagingSource).not.toMatch(/from ['"][^'"]*\/ui(?:-engine)?\//u);
    expect(packagingSource).not.toMatch(/from ['"][^'"]*persistence\//u);
    expect(packagingSource).not.toMatch(/from ['"][^'"]*\/app\//u);
    expect(packagingSource).not.toMatch(/from ['"][^'"]*engines\//u);
  });

  it('never imports browser download, clipboard, or backup/restore APIs', () => {
    for (const forbidden of [
      'navigator.clipboard',
      'ClipboardItem',
      'document.createElement',
      'URL.createObjectURL',
      'showSaveFilePicker',
      'BackupCreated',
      'RestorePlan',
      'window.',
    ]) {
      expect(packagingSource).not.toContain(forbidden);
    }
  });

  it('never reads the filesystem, wall clock, or a random source in the pure packaging core', () => {
    for (const forbidden of [
      "from 'node:fs'",
      'from "node:fs"',
      'readFileSync',
      'writeFileSync',
      'Math.random(',
      'crypto.randomUUID',
      'Date.now(',
      'new Date(',
    ]) {
      expect(packagingSource).not.toContain(forbidden);
    }
  });

  it('never depends on locale-sensitive string comparison (Intl.Collator/localeCompare)', () => {
    // Excludes doc comments describing the constraint; checks only executable calls.
    expect(packagingSource).not.toMatch(/new\s+Intl\.Collator/u);
    expect(packagingSource).not.toContain('.localeCompare(');
  });

  it('keeps packaging responsibilities in dedicated modules', () => {
    expect(packagingFiles).toEqual([
      'checksum.ts',
      'checksums-file.ts',
      'collision.ts',
      'content.ts',
      'crc32.ts',
      'index.ts',
      'input-validation.ts',
      'manifest.ts',
      'naming.ts',
      'package-entry.ts',
      'package-plan-validation.ts',
      'package-plan.ts',
      'package-result.ts',
      'package.ts',
      'path.ts',
      'slug.ts',
      'zip-verifier.ts',
      'zip-writer.ts',
    ]);
  });

  it('content.ts never imports the whole ExportPlan type (Independent Audit F2 - content builders must only receive pre-validated, session-scoped slices, never the raw plan)', () => {
    const contentSource = readFileSync(path.join(PACKAGING_ROOT, 'content.ts'), 'utf8');
    expect(contentSource).not.toMatch(/\bExportPlan\b/u);
  });

  it('buildPackageContentEntries never reads a raw plan.selection category directly (Independent Audit F2 - every selected-artifact category must come from the validated trusted index, not plan.selection.*)', () => {
    const planSource = readFileSync(path.join(PACKAGING_ROOT, 'package-plan.ts'), 'utf8');
    const start = planSource.indexOf('export function buildPackageContentEntries');
    expect(start).toBeGreaterThan(-1);
    // `hasScopePolicyViolation`/`hasDuplicateScopeIdentifiers` (above this
    // point in the file) legitimately read `plan.selection.*` for bare
    // presence/duplicate scope checks - this scan is intentionally scoped to
    // content construction itself, the function the audit's F2 finding named.
    const body = planSource.slice(start);
    expect(body).not.toMatch(/plan\.selection\./u);
  });

  it('package.ts and manifest.ts never read a raw plan.selection category directly (Final Controlled Merge §11 - named files must consume the validated trusted index, never raw selection arrays)', () => {
    for (const fileName of ['package.ts', 'manifest.ts']) {
      const source = readFileSync(path.join(PACKAGING_ROOT, fileName), 'utf8');
      expect(source, fileName).not.toMatch(/plan\.selection\./u);
      expect(source, fileName).not.toMatch(
        /\.selection\.(?:project|sessions|scenes|groups|groupPlans|outputsA|outputsB|covers|artworks|versions|executionPlans|validationResults)\b/u,
      );
    }
  });

  it('does not modify the frozen Batch 10.1-10.3 formatter/export-engine file lists', () => {
    const formatterFiles = readdirSync(LAYER_ROOTS.export)
      .filter((name) => name.endsWith('.ts'))
      .sort();
    expect(formatterFiles).toEqual([
      'canonical-json.ts',
      'document-builder.ts',
      'failures.ts',
      'format-mapping.ts',
      'format-result.ts',
      'index.ts',
      'json-serializer.ts',
      'json.ts',
      'line-endings.ts',
      'markdown.ts',
      'plan-validation.ts',
      'projection.ts',
      'result-builder.ts',
      'runtime.ts',
      'text-rendering.ts',
      'txt.ts',
      'utf8.ts',
    ]);
  });
});
