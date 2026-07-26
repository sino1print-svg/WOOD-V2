/**
 * Deterministic packaging orchestrator - EX section 2/11-19.
 *
 * Terminal, read-only layer over the approved `ExportPlanResult` and the
 * Batch 10.3 formatters: builds every content file, the manifest, the
 * checksums file, writes a deterministic ZIP, and verifies the archive before
 * ever reporting success. Never throws on hostile input; never emits partial
 * ZIP bytes on failure.
 */
import {
  ExportFormat,
  ValidationSeverity,
  type ValidationFailure,
} from '../../shared/domain-model';
import { validateExportManifestShape } from '../../shared/export-manifest-schema-validation';
import { registeredExportFailure } from '../failures';
import { prepareFormatterInput } from '../projection';
import {
  compareUtf8,
  hasExactKeys,
  inspectFormatterRuntimeValue,
  isPlainRecord,
  validFormatterLimits,
} from '../runtime';
import { buildChecksumsFile } from './checksums-file';
import { sha256Bytes } from './checksum';
import { isValidCreatedAt, isValidExportEngineVersions, isValidExportId } from './input-validation';
import { buildExportManifest, serializeManifest } from './manifest';
import type { PackageEntry } from './package-entry';
import { buildPackageContentEntries } from './package-plan';
import type {
  ExportPackageInput,
  ExportPackageResult,
  PackageEntrySummary,
} from './package-result';
import { verifyPackageZip } from './zip-verifier';
import { writeDeterministicZip } from './zip-writer';

function failureResult(
  failures: readonly ValidationFailure[],
  warnings: readonly ValidationFailure[] = [],
): ExportPackageResult {
  return { ok: false, failures, warnings, omissions: [] };
}

function singleFailure(code: string, field: string): ExportPackageResult {
  const failure =
    registeredExportFailure(code, field) ?? registeredExportFailure('EXPORT_CORRUPT_001', field);
  return failureResult(failure ? [failure] : []);
}

/**
 * Build a deterministic ZIP package from an approved export plan. Typed
 * result only; hostile or malformed input never throws and never produces
 * partial ZIP bytes.
 */
export function packageExport(input: ExportPackageInput): ExportPackageResult {
  try {
    // Reject throwing getters, toJSON traps, prototype pollution, cycles, sparse
    // arrays, and secret/path-shaped metadata before any property is read, using
    // the approved (widest) bounds; the bounded, caller-supplied-limits pass runs
    // again inside prepareFormatterInput below.
    if (inspectFormatterRuntimeValue(input) !== null) {
      return singleFailure('EXPORT_CORRUPT_001', 'packaging.input');
    }
    if (
      !isPlainRecord(input) ||
      !hasExactKeys(input, ['planResult', 'limits', 'versions', 'createdAt', 'exportId'])
    ) {
      return singleFailure('EXPORT_CORRUPT_001', 'packaging.input');
    }
    if (!validFormatterLimits(input.limits)) {
      return singleFailure('EXPORT_CORRUPT_001', 'packaging.limits');
    }
    if (
      inspectFormatterRuntimeValue(input, input.limits.maxJsonDepth, input.limits.maxZipEntries) !==
      null
    ) {
      return singleFailure('EXPORT_CORRUPT_001', 'packaging.input');
    }
    if (!isValidExportEngineVersions(input.versions, input.limits.maxZipEntries)) {
      return singleFailure('EXPORT_CORRUPT_001', 'packaging.versions');
    }
    if (!isValidCreatedAt(input.createdAt)) {
      return singleFailure('EXPORT_CORRUPT_001', 'packaging.createdAt');
    }
    if (!isValidExportId(input.exportId)) {
      return singleFailure('EXPORT_CORRUPT_001', 'packaging.exportId');
    }

    const prepared = prepareFormatterInput({ planResult: input.planResult, limits: input.limits });
    if (!prepared.ok) return failureResult(prepared.failures);

    const plan = prepared.value.plan;
    const warnings = plan.issues.filter((issue) => issue.severity === ValidationSeverity.Warning);

    const planned = buildPackageContentEntries(
      plan,
      { planResult: input.planResult, limits: input.limits },
      input.limits,
    );
    if (!planned.ok) return failureResult(planned.failures, warnings);

    const totalContentBytes = planned.entries.reduce((sum, entry) => sum + entry.byteLength, 0);
    if (
      planned.entries.length > input.limits.maxZipEntries ||
      totalContentBytes > input.limits.maxUncompressedBytes
    ) {
      return failureResult(
        [registeredExportFailure('EXPORT_STORAGE_001', 'packaging.entries')!],
        warnings,
      );
    }

    const relativePath = (fullPath: string): string =>
      fullPath.slice(planned.projectSlug.length + 1);

    const manifest = buildExportManifest({
      plan,
      versions: input.versions,
      createdAt: input.createdAt,
      exportId: input.exportId,
      contentEntries: planned.entries.map((entry) => ({
        ...entry,
        path: relativePath(entry.path),
      })),
    });

    const schemaIssues = validateExportManifestShape(manifest);
    if (schemaIssues.length > 0) {
      return failureResult(
        [registeredExportFailure('EXPORT_CORRUPT_001', 'packaging.manifest')!],
        warnings,
      );
    }

    const serializedManifest = serializeManifest(
      manifest,
      input.limits.maxJsonBytes,
      input.limits.maxJsonDepth,
      input.limits.maxZipEntries,
    );
    if (serializedManifest === null) {
      return failureResult(
        [registeredExportFailure('EXPORT_STORAGE_001', 'packaging.manifest')!],
        warnings,
      );
    }
    const manifestChecksum = sha256Bytes(serializedManifest.bytes);

    const checksumLines = [
      ...planned.entries.map((entry) => ({
        path: relativePath(entry.path),
        checksum: entry.checksum,
      })),
      { path: 'manifest.json', checksum: manifestChecksum },
    ];
    const checksumsFile = buildChecksumsFile(checksumLines, input.limits.maxJsonBytes);
    if (checksumsFile === null) {
      return failureResult(
        [registeredExportFailure('EXPORT_STORAGE_001', 'packaging.checksums')!],
        warnings,
      );
    }
    const checksumsChecksum = sha256Bytes(checksumsFile.bytes);

    const manifestEntry: PackageEntry = {
      path: `${planned.projectSlug}/manifest.json`,
      kind: 'manifest',
      format: ExportFormat.Json,
      mediaType: 'application/json',
      bytes: serializedManifest.bytes,
      byteLength: serializedManifest.bytes.byteLength,
      checksum: manifestChecksum,
    };
    const checksumsEntry: PackageEntry = {
      path: `${planned.projectSlug}/checksums.sha256`,
      kind: 'checksums',
      format: ExportFormat.Txt,
      mediaType: 'text/plain;charset=utf-8',
      bytes: checksumsFile.bytes,
      byteLength: checksumsFile.bytes.byteLength,
      checksum: checksumsChecksum,
    };
    const allEntries: readonly PackageEntry[] = [...planned.entries, manifestEntry, checksumsEntry]
      .slice()
      .sort((a, b) => compareUtf8(a.path, b.path));

    const zipWrite = writeDeterministicZip(
      allEntries,
      input.limits.maxZipEntries,
      input.limits.maxArchiveBytes,
    );
    if (!zipWrite.ok) {
      return failureResult([registeredExportFailure('EXPORT_ZIP_001', 'packaging.zip')!], warnings);
    }

    const verification = verifyPackageZip(
      zipWrite.bytes,
      allEntries.map((entry) => ({ path: entry.path, checksum: entry.checksum })),
    );
    if (!verification.ok) {
      return failureResult(
        [registeredExportFailure('EXPORT_CORRUPT_001', `packaging.verify.${verification.reason}`)!],
        warnings,
      );
    }

    const entrySummaries: readonly PackageEntrySummary[] = allEntries.map((entry) => ({
      path: entry.path,
      kind: entry.kind,
      byteLength: entry.byteLength,
      checksum: entry.checksum,
    }));

    return {
      ok: true,
      zipBytes: zipWrite.bytes,
      zipSha256: sha256Bytes(zipWrite.bytes),
      manifestBytes: serializedManifest.bytes,
      checksumsBytes: checksumsFile.bytes,
      entries: entrySummaries,
      warnings,
      omissions: plan.omissions,
    };
  } catch {
    return singleFailure('EXPORT_CORRUPT_001', 'packaging.input');
  }
}
