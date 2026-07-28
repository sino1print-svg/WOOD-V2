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
const sourceOf = (name: string): string => readFileSync(path.join(PACKAGING_ROOT, name), 'utf8');

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

  it('keeps every post-validation consumer on the detached trusted projection', () => {
    const packageSource = sourceOf('package.ts');
    const validationCall = 'const integrity = validatePackagePlanIntegrity(plan, input.limits);';
    const boundaryOffset = packageSource.indexOf(validationCall);
    expect(boundaryOffset).toBeGreaterThan(-1);
    const postValidationSource = packageSource.slice(boundaryOffset + validationCall.length);
    expect(postValidationSource).not.toMatch(
      /\bplan\.(?:selection|numbering|groupNumbering|provenance|scope)\b/u,
    );
    expect(postValidationSource).toContain(
      'buildPackageContentEntries(integrity.value, input.limits)',
    );
    expect(postValidationSource).toContain('validated: integrity.value');

    const planBuilderSource = sourceOf('package-plan.ts');
    const buildOffset = planBuilderSource.indexOf('export function buildPackageContentEntries(');
    expect(buildOffset).toBeGreaterThan(-1);
    const buildSource = planBuilderSource.slice(buildOffset);
    expect(buildSource).toContain('validated: ValidatedPackagePlanIndex');
    expect(buildSource).toContain('const trustedPlan = validated.plan');
    expect(buildSource).not.toMatch(/\bplan\.(?:selection|numbering|groupNumbering)\b/u);

    // `content.ts` is this tree's existing content-builders module. It now
    // receives already-indexed session values and cannot search a raw plan.
    const contentBuildersSource = sourceOf('content.ts');
    expect(contentBuildersSource).not.toMatch(/\bExportPlan\b/u);
    expect(contentBuildersSource).not.toContain('.selection');
    expect(contentBuildersSource).not.toContain('.find(');
    expect(contentBuildersSource).not.toContain('.filter(');

    const manifestSource = sourceOf('manifest.ts');
    expect(manifestSource).toContain('readonly validated: ValidatedPackagePlanIndex');
    expect(manifestSource).toContain('const plan = validated.plan');

    // Raw plan traversal is intentionally permitted only inside this single
    // boundary, which snapshots first and returns runtime-read-only views.
    const boundarySource = sourceOf('package-plan-validation.ts');
    expect(boundarySource).toContain('trustedPlan = snapshotTrustedPlan(plan)');
    expect(boundarySource).toContain('plan: trustedPlan');
    expect(boundarySource).toContain('class ReadonlyMapView');
  });
});
