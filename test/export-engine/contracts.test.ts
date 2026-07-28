import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../../src/config/app-config';
import {
  DomainEventType,
  EngineId,
  ExportFormat,
  ExportScope,
} from '../../src/shared/domain-model';
import {
  CANONICAL_EXPORT_ARTIFACT,
  CANONICAL_EXPORT_EVENTS,
  CANONICAL_EXPORT_INPUT,
  CANONICAL_EXPORT_RESULT,
  CANONICAL_SCOPES,
} from './fixtures';

const ROOT = path.resolve('.');
const read = (relativePath: string): string => readFileSync(path.join(ROOT, relativePath), 'utf8');

describe('Export Coordinator additive contracts', () => {
  it('keeps the legacy contract signature intact', () => {
    const source = read('src/shared/contracts/engine-contracts.ts');
    expect(source).toMatch(
      /export interface ExportEngineContract\s*\{\s*export\(\s*session: PhotoshootSession,\s*scope: ExportScope,\s*formats: readonly ExportFormat\[\],\s*\): EngineResult<ExportManifest>;\s*\}/,
    );
  });

  it('publishes a separate rich coordinator contract', () => {
    const source = read('src/shared/contracts/export-contracts.ts');
    expect(source).toContain('export interface ExportCoordinatorContract');
    expect(source).toContain('export(input: ExportEngineInput): Promise<ExportEngineResult>');
    expect(read('src/shared/contracts/index.ts')).toContain("export * from './export-contracts'");
  });

  it('keeps every contracts-layer declaration type-only', () => {
    const source = read('src/shared/contracts/export-contracts.ts');
    expect(source).not.toMatch(/^export\s+(const|let|var|function|class|enum|default)\b/m);
    expect(source).not.toContain('Date.now');
    expect(source).not.toContain('Math.random');
  });

  it('requires a caller-supplied timestamp, versions, limits, and non-empty formats', () => {
    expect(CANONICAL_EXPORT_INPUT.createdAt).toBe('2026-07-26T10:00:00.000Z');
    expect(CANONICAL_EXPORT_INPUT.formats.length).toBeGreaterThan(0);
    expect(CANONICAL_EXPORT_INPUT.versions.applicationVersion).toBe('0.1.0');
    expect(CANONICAL_EXPORT_INPUT.limits).toBe(APP_CONFIG.limits.export);
  });

  it('covers every specified operational scope while preserving its DM base scope', () => {
    expect([...new Set(CANONICAL_SCOPES.map((scope) => scope.scopeDetail))]).toEqual([
      'output_a',
      'output_b',
      'pair',
      'group',
      'group_a',
      'group_b',
      'cover',
      'session',
      'execution_plan',
      'complete_project',
      'backup',
      'version_snapshot',
      'prompt_pack',
      'all',
    ]);
    expect(CANONICAL_SCOPES[0]?.baseScope).toBe(ExportScope.Output);
    expect(CANONICAL_SCOPES[3]?.baseScope).toBe(ExportScope.Group);
    expect(CANONICAL_SCOPES[6]?.baseScope).toBe(ExportScope.Cover);
    expect(CANONICAL_SCOPES[7]?.baseScope).toBe(ExportScope.Session);
    expect(CANONICAL_SCOPES.at(-1)?.baseScope).toBe(ExportScope.All);
  });

  it('keeps clipboard and markdown operational without widening persisted formats', () => {
    expect(CANONICAL_EXPORT_INPUT.formats).toContain('clipboard');
    expect(CANONICAL_EXPORT_INPUT.formats).toContain('markdown');
    expect(Object.values(ExportFormat)).toEqual(['txt', 'json', 'zip']);
    expect(CANONICAL_EXPORT_RESULT.ok).toBe(true);
    if (!CANONICAL_EXPORT_RESULT.ok) return;
    expect(CANONICAL_EXPORT_RESULT.value.manifest.exportFormats).toEqual([
      ExportFormat.Txt,
      ExportFormat.Json,
    ]);
    expect(CANONICAL_EXPORT_RESULT.value.requestedFormats).toContain('clipboard');
  });
});

describe('Export artifact, delivery, cancellation, and progress boundaries', () => {
  it('defines a byte-bearing artifact with an explicit kind, media type, size, and checksum', () => {
    expect(CANONICAL_EXPORT_ARTIFACT.bytes).toBeInstanceOf(Uint8Array);
    expect(CANONICAL_EXPORT_ARTIFACT.byteLength).toBe(CANONICAL_EXPORT_ARTIFACT.bytes.byteLength);
    expect(CANONICAL_EXPORT_ARTIFACT.checksum).toHaveLength(64);
    expect(CANONICAL_EXPORT_ARTIFACT.path).not.toMatch(/^(?:[A-Za-z]:[\\/]|\/)/);
  });

  it('keeps ports declarative and exposes no delivery behavior in this batch', () => {
    const source = read('src/shared/contracts/export-contracts.ts');
    expect(source).toContain('export interface ExportClipboardPort');
    expect(source).toContain('export interface ExportDownloadPort');
    expect(source).toContain('export interface ExportCancellationPort');
    expect(source).toContain('export interface ExportProgressPort');
    expect(read('src/engines/export-engine/index.ts')).toContain(
      "export { createExportPlan } from './engine'",
    );
    expect(read('src/engines/export-engine/engine.ts')).not.toContain('.deliver(');
    expect(read('src/engines/export-engine/engine.ts')).not.toContain('.write(');
  });

  it('models failure without any partial artifact field', () => {
    const source = read('src/shared/contracts/export-contracts.ts');
    const failureBranch = source.slice(
      source.indexOf('readonly ok: false;\n      readonly failures'),
      source.indexOf('/** Rich asynchronous coordinator boundary'),
    );
    expect(failureBranch).not.toContain('artifacts:');
    expect(failureBranch).not.toContain('deliveries:');
  });

  it('adds bounded export/import resource limits without removing legacy path limits', () => {
    const { limits } = APP_CONFIG;
    expect(limits.maxPathSegment).toBe(60);
    expect(limits.maxPathLength).toBe(200);
    expect(limits.export.maxPathSegment).toBe(limits.maxPathSegment);
    expect(limits.export.maxPathLength).toBe(limits.maxPathLength);
    expect(limits.export.maxJsonDepth).toBeGreaterThan(0);
    expect(limits.export.maxZipEntries).toBeGreaterThan(0);
    expect(limits.export.maxCompressionRatio).toBeGreaterThan(1);
    expect(limits.export.maxArchiveBytes).toBeLessThanOrEqual(limits.export.maxUncompressedBytes);
    expect(limits.export.maxClipboardBytes).toBeGreaterThan(0);
  });
});

describe('Export audit event contracts', () => {
  it('defines the complete EX §23 event catalog', () => {
    expect(CANONICAL_EXPORT_EVENTS.map((event) => event.type)).toEqual([
      DomainEventType.ExportStarted,
      DomainEventType.ExportCompleted,
      DomainEventType.ExportFailed,
      DomainEventType.BackupCreated,
      DomainEventType.RestoreStarted,
      DomainEventType.RestoreCompleted,
      DomainEventType.RestoreFailed,
      DomainEventType.ClipboardCopyCompleted,
      DomainEventType.ClipboardCopyFailed,
    ]);
  });

  it('encodes Export as read-only owner and Persistence as restore-application owner', () => {
    const byType = new Map(CANONICAL_EXPORT_EVENTS.map((event) => [event.type, event]));
    expect(byType.get(DomainEventType.ExportStarted)?.emittedBy).toBe(EngineId.Export);
    expect(byType.get(DomainEventType.RestoreStarted)?.emittedBy).toBe(EngineId.Export);
    expect(byType.get(DomainEventType.RestoreCompleted)?.emittedBy).toBe(EngineId.Persistence);
    expect(byType.get(DomainEventType.RestoreFailed)?.emittedBy).toBe(EngineId.Persistence);
  });

  it('contains identifiers, counts, codes, and checksums but no sensitive payload fields', () => {
    const encoded = JSON.stringify(CANONICAL_EXPORT_EVENTS);
    for (const forbidden of [
      'promptText',
      'promptBytes',
      'artworkBytes',
      'absolutePath',
      'ownerRef',
      'secret',
      'token',
    ]) {
      expect(encoded).not.toContain(forbidden);
    }
  });

  it('forbids sensitive payload properties in the event type declarations', () => {
    const source = read('src/shared/contracts/export-contracts.ts');
    const eventDeclarations = source.slice(
      source.indexOf('interface ExportOwnedEvent'),
      source.indexOf('export type ExportAuditEvent'),
    );
    for (const forbidden of [
      'promptText',
      'promptBytes',
      'artworkBytes',
      'absolutePath',
      'ownerRef',
      'secret',
      'token',
    ]) {
      expect(eventDeclarations).not.toContain(forbidden);
    }
  });
});
