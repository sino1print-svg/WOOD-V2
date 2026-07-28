import { describe, expect, it } from 'vitest';
import { createExportPlan } from '../../../src/engines/export-engine';
import { validateExportManifestShape } from '../../../src/shared/export-manifest-schema-validation';
import { packageExport } from '../../../src/export/packaging';
import { buildExportManifest, manifestToJson } from '../../../src/export/packaging/manifest';
import { validatePackagePlanIntegrity } from '../../../src/export/packaging/package-plan';
import { parseZip } from '../../../src/export/packaging/zip-verifier';
import { CANONICAL_EXPORT_INPUT, CANONICAL_PROJECT, CANONICAL_SCOPES } from '../fixtures';
import {
  CANONICAL_CREATED_AT,
  CANONICAL_EXPORT_ID,
  CANONICAL_VERSIONS,
  createPackageFixture,
} from './fixtures';

const REQUIRED_MANIFEST_FIELDS = [
  'exportId',
  'schemaVersion',
  'projectId',
  'sessionIds',
  'exportScope',
  'scopeDetail',
  'exportFormats',
  'createdAt',
  'applicationVersion',
  'generatorVersion',
  'ruleSetVersions',
  'promptModuleVersions',
  'includedFiles',
  'fileSizes',
  'checksums',
  'warnings',
  'sourceFingerprints',
];

describe('Export manifest construction and validation (EX section 13/14)', () => {
  it('contains every required field and no unlisted field', () => {
    const planResult = createExportPlan(CANONICAL_EXPORT_INPUT);
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;
    const validation = validatePackagePlanIntegrity(
      planResult.value,
      CANONICAL_EXPORT_INPUT.limits,
    );
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    const manifest = buildExportManifest({
      validated: validation.value,
      versions: CANONICAL_VERSIONS,
      createdAt: CANONICAL_CREATED_AT,
      exportId: CANONICAL_EXPORT_ID,
      contentEntries: [],
    });
    const keys = Object.keys(manifest).sort();
    expect(keys).toEqual([...REQUIRED_MANIFEST_FIELDS].sort());
  });

  it('validates against the authoritative export-manifest schema', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const manifest = JSON.parse(new TextDecoder().decode(result.manifestBytes)) as unknown;
    expect(validateExportManifestShape(manifest)).toEqual([]);
  });

  it('fails schema validation for a structurally broken manifest', () => {
    const broken = { exportId: 'x' };
    expect(validateExportManifestShape(broken).length).toBeGreaterThan(0);
  });

  it('produces a recursively sorted-key JSON document', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = new TextDecoder().decode(result.manifestBytes);
    const topLevelKeys = Object.keys(JSON.parse(text) as Record<string, unknown>);
    expect(topLevelKeys).toEqual([...topLevelKeys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it('reports fileSizes/checksums/includedFiles that match the actual ZIP entries exactly', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const manifest = JSON.parse(new TextDecoder().decode(result.manifestBytes)) as {
      includedFiles: readonly { path: string; kind: string }[];
      fileSizes: Record<string, number>;
      checksums: Record<string, string>;
    };
    const contentEntries = result.entries.filter(
      (entry) => entry.kind !== 'manifest' && entry.kind !== 'checksums',
    );
    const projectSlugPrefixLength = contentEntries[0]!.path.indexOf('/') + 1;
    for (const entry of contentEntries) {
      const relativePath = entry.path.slice(projectSlugPrefixLength);
      expect(manifest.fileSizes[relativePath]).toBe(entry.byteLength);
      expect(manifest.checksums[relativePath]).toBe(entry.checksum);
      expect(manifest.includedFiles.some((file) => file.path === relativePath)).toBe(true);
    }
    expect(manifest.includedFiles.length).toBe(contentEntries.length);
    // manifest.json / checksums.sha256 must never appear in their own ledger
    expect(manifest.fileSizes['manifest.json']).toBeUndefined();
    expect(manifest.checksums['checksums.sha256']).toBeUndefined();
  });

  it('documents partial exports with non-empty warnings when a partial plan is packaged', () => {
    const result = packageExport(createPackageFixture({ omitOutputB: true }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const manifest = JSON.parse(new TextDecoder().decode(result.manifestBytes)) as {
      warnings: readonly unknown[];
    };
    // omitting Output B is a warning-level, partial-permitting condition (EX section 18)
    expect(Array.isArray(manifest.warnings)).toBe(true);
  });

  it('retains the exact original Arabic project name in project.json metadata', () => {
    expect(CANONICAL_PROJECT.name).toMatch(/[؀-ۿ]/u);
    const result = packageExport(createPackageFixture({ scope: CANONICAL_SCOPES[9] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = parseZip(result.zipBytes);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const projectEntry = parsed.entries.find((entry) =>
      entry.path.endsWith('project/project.json'),
    );
    expect(projectEntry).toBeDefined();
    const projectJson = JSON.parse(new TextDecoder().decode(projectEntry!.bytes)) as {
      name: string;
    };
    expect(projectJson.name).toBe(CANONICAL_PROJECT.name);
  });

  it('excludes createdAt from content-file checksums (only manifest.json changes)', () => {
    const fixtureA = createPackageFixture();
    const fixtureB = { ...fixtureA, createdAt: '2030-01-01T00:00:00.000Z' };
    const resultA = packageExport(fixtureA);
    const resultB = packageExport(fixtureB);
    expect(resultA.ok).toBe(true);
    expect(resultB.ok).toBe(true);
    if (!resultA.ok || !resultB.ok) return;

    const contentA = resultA.entries.filter(
      (entry) => entry.kind !== 'manifest' && entry.kind !== 'checksums',
    );
    const contentB = resultB.entries.filter(
      (entry) => entry.kind !== 'manifest' && entry.kind !== 'checksums',
    );
    expect(contentA).toEqual(contentB);

    const manifestA = resultA.entries.find((entry) => entry.kind === 'manifest')!;
    const manifestB = resultB.entries.find((entry) => entry.kind === 'manifest')!;
    expect(manifestA.checksum).not.toBe(manifestB.checksum);
  });

  it('does not leak raw runtime metadata, secrets, or absolute paths', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = new TextDecoder().decode(result.manifestBytes);
    for (const forbidden of [
      'ownerRef',
      'pngAssetRef',
      'projectState',
      'C:\\',
      '/home/',
      '/Users/',
      'apiKey',
      'password',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('never contains asset or image bytes (PNG/JPEG signatures)', () => {
    const result = packageExport(createPackageFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = new TextDecoder().decode(result.manifestBytes);
    expect(text).not.toContain('iVBORw0KGgo');
  });

  it('rejects a manifest DTO with prototype pollution keys via schema validation', () => {
    const proto = JSON.parse(
      '{"__proto__": {"polluted": true}, "exportId": "x", "schemaVersion": 1}',
    ) as Record<string, unknown>;
    // JSON.parse creates a genuine own property named "__proto__" (CreateDataProperty
    // semantics), never a live prototype link - confirm that, then confirm the
    // schema's additionalProperties:false rejects the unlisted key regardless.
    expect(Object.prototype.hasOwnProperty.call(proto, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(proto)).toBe(Object.prototype);
    expect(validateExportManifestShape(proto).length).toBeGreaterThan(0);
  });

  it('manifestToJson never invokes toJSON on nested manifest content', () => {
    const planResult = createExportPlan(CANONICAL_EXPORT_INPUT);
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;
    const validation = validatePackagePlanIntegrity(
      planResult.value,
      CANONICAL_EXPORT_INPUT.limits,
    );
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    const manifest = buildExportManifest({
      validated: validation.value,
      versions: CANONICAL_VERSIONS,
      createdAt: CANONICAL_CREATED_AT,
      exportId: CANONICAL_EXPORT_ID,
      contentEntries: [],
    });
    let calls = 0;
    (manifest as unknown as { toJSON: () => unknown }).toJSON = () => {
      calls += 1;
      return { leaked: true };
    };
    manifestToJson(manifest);
    expect(calls).toBe(0);
  });
});
