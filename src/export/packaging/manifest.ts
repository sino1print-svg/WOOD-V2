/**
 * Final export manifest construction - EX section 13/14.
 *
 * Builds the persisted `ExportManifest` DTO by allowlisted field-by-field
 * projection only; no Project/Session/Scene/runtime object is ever passed to
 * the serializer. `manifest.json`/`checksums.sha256` are excluded from the
 * manifest's own `includedFiles`/`fileSizes`/`checksums` maps (section 3.6) so
 * there is no self-referential hash.
 */
import {
  ExportFormat,
  ValidationSeverity,
  type ExportManifest,
  type ExportManifestWarning,
  type Sha256,
} from '../../shared/domain-model';
import type { ExportEngineVersions } from '../../shared/contracts/export-contracts';
import type { ExportPlan } from '../../shared/contracts/export-planning';
import { ERROR_BY_CODE } from '../../shared/errors';
import { compareUtf8 } from '../runtime';
import {
  serializeExportJson,
  type ExportJsonObject,
  type ExportJsonValue,
} from '../json-serializer';
import type { PackageEntry } from './package-entry';

function warningsFromPlan(plan: ExportPlan): readonly ExportManifestWarning[] {
  return plan.issues
    .filter((issue) => issue.severity === ValidationSeverity.Warning)
    .map((issue) => {
      const registered = ERROR_BY_CODE[issue.code];
      return {
        code: issue.code,
        messageAr: registered?.messageAr ?? issue.message,
        messageEn: registered?.messageEn ?? issue.code,
      };
    });
}

/**
 * Authoritative provenance, taken verbatim from `plan.provenance` (EX §13
 * First Corrective F5) - real source session/scene/cover hashes, never a
 * fallback hash of `projectId` or any other synthetic/placeholder value.
 */
function sourceFingerprints(plan: ExportPlan): ExportManifest['sourceFingerprints'] {
  const { sessionFingerprint, sceneFingerprints, coverHash } = plan.provenance;
  const output: {
    sessionFingerprint: Sha256;
    sceneFingerprints?: readonly Sha256[];
    coverHash?: Sha256;
  } = { sessionFingerprint };
  if (sceneFingerprints.length > 0) output.sceneFingerprints = sceneFingerprints;
  if (coverHash !== null) output.coverHash = coverHash;
  return output;
}

export interface ManifestBuildOptions {
  readonly plan: ExportPlan;
  readonly versions: ExportEngineVersions;
  readonly createdAt: string;
  readonly exportId: string;
  readonly contentEntries: readonly PackageEntry[];
}

/** Build the allowlisted manifest DTO. `manifest.json`/`checksums.sha256` are content-entry-exempt by construction (they are never in `contentEntries`). */
export function buildExportManifest(options: ManifestBuildOptions): ExportManifest {
  const { plan, versions, createdAt, exportId, contentEntries } = options;
  const sortedEntries = [...contentEntries].sort((a, b) => compareUtf8(a.path, b.path));
  const includedFiles = sortedEntries.map((entry) => ({ path: entry.path, kind: entry.kind }));
  const fileSizes: Record<string, number> = {};
  const checksums: Record<string, Sha256> = {};
  for (const entry of sortedEntries) {
    fileSizes[entry.path] = entry.byteLength;
    checksums[entry.path] = entry.checksum;
  }
  return {
    exportId,
    schemaVersion: 1,
    projectId: plan.scope.projectId,
    sessionIds: [...plan.scope.sessionIds],
    exportScope: plan.scope.baseScope,
    scopeDetail: plan.scope.scopeDetail,
    exportFormats: [ExportFormat.Zip],
    createdAt: createdAt as ExportManifest['createdAt'],
    applicationVersion: versions.applicationVersion,
    generatorVersion: versions.generatorVersion,
    ruleSetVersions: versions.ruleSetVersions,
    promptModuleVersions: versions.promptModuleVersions,
    includedFiles,
    fileSizes,
    checksums,
    warnings: warningsFromPlan(plan),
    sourceFingerprints: sourceFingerprints(plan),
  };
}

function stringRecordToJson(source: Readonly<Record<string, string>>): ExportJsonObject {
  const output: Record<string, ExportJsonValue> = {};
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (value !== undefined) output[key] = value;
  }
  return output;
}

function numberRecordToJson(source: Readonly<Record<string, number>>): ExportJsonObject {
  const output: Record<string, ExportJsonValue> = {};
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (value !== undefined) output[key] = value;
  }
  return output;
}

/** Canonical (recursively sorted-key) JSON projection of the manifest DTO. */
export function manifestToJson(manifest: ExportManifest): ExportJsonObject {
  const sourceFingerprintsJson: Record<string, ExportJsonValue> = {
    sessionFingerprint: manifest.sourceFingerprints.sessionFingerprint,
  };
  if (manifest.sourceFingerprints.sceneFingerprints !== undefined) {
    sourceFingerprintsJson.sceneFingerprints = [...manifest.sourceFingerprints.sceneFingerprints];
  }
  if (manifest.sourceFingerprints.coverHash !== undefined) {
    sourceFingerprintsJson.coverHash = manifest.sourceFingerprints.coverHash;
  }
  return {
    exportId: manifest.exportId,
    schemaVersion: manifest.schemaVersion,
    projectId: manifest.projectId,
    sessionIds: [...manifest.sessionIds],
    exportScope: manifest.exportScope,
    scopeDetail: manifest.scopeDetail,
    exportFormats: [...manifest.exportFormats],
    createdAt: manifest.createdAt,
    applicationVersion: manifest.applicationVersion,
    generatorVersion: manifest.generatorVersion,
    ruleSetVersions: numberRecordToJson(manifest.ruleSetVersions),
    promptModuleVersions: stringRecordToJson(manifest.promptModuleVersions),
    includedFiles: manifest.includedFiles.map((file) => ({ path: file.path, kind: file.kind })),
    fileSizes: numberRecordToJson(manifest.fileSizes),
    checksums: stringRecordToJson(manifest.checksums),
    warnings: manifest.warnings.map((warning) => ({
      code: warning.code,
      messageAr: warning.messageAr,
      messageEn: warning.messageEn,
    })),
    sourceFingerprints: sourceFingerprintsJson,
  };
}

export interface SerializedManifest {
  readonly bytes: Uint8Array;
  readonly text: string;
}

export function serializeManifest(
  manifest: ExportManifest,
  maximumBytes: number,
  maximumDepth: number,
  maximumArrayLength: number,
): SerializedManifest | null {
  const built = serializeExportJson(manifestToJson(manifest), {
    indentation: 2,
    trailingLf: true,
    maximumBytes,
    maximumDepth,
    maximumArrayLength,
  });
  return built ? { bytes: built.bytes, text: built.text } : null;
}
