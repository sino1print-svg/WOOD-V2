import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAYER_ROOTS, checkAllowedTargets, checkEngineMatrix, scan } from '../architecture/scan';

const EXPORT_ENGINE_ROOT = path.join(LAYER_ROOTS.engines, 'export-engine');
const FORMATTER_ROOT = LAYER_ROOTS.export;
const { edges, unresolvedInternal } = scan();
const source = readdirSync(EXPORT_ENGINE_ROOT)
  .filter((name) => name.endsWith('.ts'))
  .sort()
  .map((name) => readFileSync(path.join(EXPORT_ENGINE_ROOT, name), 'utf8'))
  .join('\n');

describe('Export Engine planning architecture', () => {
  it('resolves every internal dependency and imports only approved read-only layers', () => {
    expect(unresolvedInternal).toEqual([]);
    expect(
      checkAllowedTargets(edges, EXPORT_ENGINE_ROOT, [LAYER_ROOTS.shared, LAYER_ROOTS.config]),
    ).toEqual([]);
  });

  it('imports no engine implementation', () => {
    expect(
      checkEngineMatrix(
        edges.filter(
          (edge) =>
            edge.from === EXPORT_ENGINE_ROOT ||
            edge.from.startsWith(`${EXPORT_ENGINE_ROOT}${path.sep}`),
        ),
      ),
    ).toEqual([]);
  });

  it('contains the Batch 10.2 planner without later-batch implementations', () => {
    expect(source).toContain('export function createExportPlan');
    expect(source).not.toContain('application/zip');
    expect(source).not.toContain('checksums.sha256');
    expect(source).not.toContain('ClipboardItem');
    expect(source).not.toContain('navigator.clipboard');
    expect(source).not.toContain("from '../../persistence");
    expect(source).not.toContain("from '../../ui");
    expect(source).not.toContain("from '../../app");
  });

  it('adds no formatter, ZIP, clipboard, backup, or restore behavior module', () => {
    expect(
      readdirSync(EXPORT_ENGINE_ROOT)
        .filter((name) => name.endsWith('.ts'))
        .sort(),
    ).toEqual([
      'engine.ts',
      'events.ts',
      'failures.ts',
      'index.ts',
      'ordering.ts',
      'runtime.ts',
      'scope.ts',
      'selection.ts',
      'types.ts',
      'validation.ts',
    ]);
  });
});

describe('Batch 10.3 formatter architecture', () => {
  const formatterFileNames = readdirSync(FORMATTER_ROOT)
    .filter((name) => name.endsWith('.ts'))
    .sort();
  // `index.ts` is the deliberate Batch 10.4 integration seam (it re-exports the
  // `packaging/` subdirectory - EX First Corrective F7); every other top-level
  // file remains pure Batch 10.1-10.3 formatter implementation with zero
  // packaging content, checked below.
  const pureFormatterSource = formatterFileNames
    .filter((name) => name !== 'index.ts')
    .map((name) => readFileSync(path.join(FORMATTER_ROOT, name), 'utf8'))
    .join('\n');
  const indexSource = readFileSync(path.join(FORMATTER_ROOT, 'index.ts'), 'utf8');

  it('imports only shared contracts, config, and formatter-local modules', () => {
    expect(
      checkAllowedTargets(edges, FORMATTER_ROOT, [LAYER_ROOTS.shared, LAYER_ROOTS.config]),
    ).toEqual([]);
  });

  it('imports no engine, UI, persistence, or application module', () => {
    const formatterSource = `${pureFormatterSource}\n${indexSource}`;
    expect(formatterSource).not.toMatch(/from ['"][^'"]*engines\//u);
    expect(formatterSource).not.toMatch(/from ['"][^'"]*(?:ui|ui-engine)\//u);
    expect(formatterSource).not.toMatch(/from ['"][^'"]*persistence\//u);
    expect(formatterSource).not.toMatch(/from ['"][^'"]*app\//u);
  });

  it('contains no Batch 10.4 packaging or delivery implementation outside the index.ts re-export seam', () => {
    expect(pureFormatterSource).not.toContain('checksums.sha256');
    expect(pureFormatterSource).not.toContain('navigator.clipboard');
    expect(pureFormatterSource).not.toContain('ClipboardItem');
    expect(pureFormatterSource).not.toContain('CompressionStream');
    expect(pureFormatterSource).not.toContain('BackupCreated');
    expect(pureFormatterSource).not.toContain('RestorePlan');
  });

  it('index.ts re-exports the Batch 10.4 packaging public surface (no clipboard/backup/restore leakage)', () => {
    expect(indexSource).toContain("from './packaging'");
    expect(indexSource).not.toContain('navigator.clipboard');
    expect(indexSource).not.toContain('ClipboardItem');
    expect(indexSource).not.toContain('BackupCreated');
    expect(indexSource).not.toContain('RestorePlan');
  });

  it('keeps formatter responsibilities in separate modules', () => {
    expect(formatterFileNames).toEqual([
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
