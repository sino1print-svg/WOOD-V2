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
  const formatterSource = readdirSync(FORMATTER_ROOT)
    .filter((name) => name.endsWith('.ts'))
    .sort()
    .map((name) => readFileSync(path.join(FORMATTER_ROOT, name), 'utf8'))
    .join('\n');

  it('imports only shared contracts, config, and formatter-local modules', () => {
    expect(
      checkAllowedTargets(edges, FORMATTER_ROOT, [LAYER_ROOTS.shared, LAYER_ROOTS.config]),
    ).toEqual([]);
  });

  it('imports no engine, UI, persistence, or application module', () => {
    expect(formatterSource).not.toMatch(/from ['"][^'"]*engines\//u);
    expect(formatterSource).not.toMatch(/from ['"][^'"]*(?:ui|ui-engine)\//u);
    expect(formatterSource).not.toMatch(/from ['"][^'"]*persistence\//u);
    expect(formatterSource).not.toMatch(/from ['"][^'"]*app\//u);
  });

  it('contains no Batch 10.4+ packaging or delivery implementation', () => {
    expect(formatterSource).not.toContain('checksums.sha256');
    expect(formatterSource).not.toContain('navigator.clipboard');
    expect(formatterSource).not.toContain('ClipboardItem');
    expect(formatterSource).not.toContain('CompressionStream');
    expect(formatterSource).not.toContain('BackupCreated');
    expect(formatterSource).not.toContain('RestorePlan');
  });

  it('keeps formatter responsibilities in separate modules', () => {
    expect(
      readdirSync(FORMATTER_ROOT)
        .filter((name) => name.endsWith('.ts'))
        .sort(),
    ).toEqual([
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
