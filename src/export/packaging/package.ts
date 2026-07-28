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
import type { ExportPlanOmission } from '../../shared/contracts/export-planning';
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
import {
  buildPackageContentEntries,
  preciseScopeKindFieldFailure,
  validatePackagePlanIntegrity,
} from './package-plan';
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
  omissions: readonly ExportPlanOmission[] = [],
): ExportPackageResult {
  return { ok: false, failures, warnings, omissions };
}

function singleFailure(code: string, field: string): ExportPackageResult {
  const failure =
    registeredExportFailure(code, field) ?? registeredExportFailure('EXPORT_CORRUPT_001', field);
  return failureResult(failure ? [failure] : []);
}

const MISSING_DATA_PROPERTY = Symbol('missing-data-property');

function ownDataProperty(value: unknown, key: string): unknown | typeof MISSING_DATA_PROPERTY {
  if (value === null || typeof value !== 'object') return MISSING_DATA_PROPERTY;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : MISSING_DATA_PROPERTY;
}

/**
 * Preserve the hostile-runtime boundary while attributing malformed nested
 * metadata to the exact frozen acceptance field. Descriptor reads never
 * execute getters; an unresolvable hostile wrapper remains packaging.input.
 */
function preciseRuntimeFailureField(input: unknown): string {
  try {
    const planResult = ownDataProperty(input, 'planResult');
    if (planResult === MISSING_DATA_PROPERTY) return 'packaging.input';
    const ok = ownDataProperty(planResult, 'ok');
    if (ok !== true) return 'packaging.input';
    const plan = ownDataProperty(planResult, 'value');
    if (plan === MISSING_DATA_PROPERTY) return 'packaging.input';
    const selection = ownDataProperty(plan, 'selection');
    if (selection !== MISSING_DATA_PROPERTY) {
      const categories = [
        'project',
        'sessions',
        'groups',
        'groupPlans',
        'scenes',
        'outputsA',
        'outputsB',
        'covers',
        'artworks',
        'products',
        'seasons',
        'colors',
        'validationResults',
        'versions',
        'executionPlans',
        'ordered',
      ] as const;
      for (const category of categories) {
        const value = ownDataProperty(selection, category);
        if (value === MISSING_DATA_PROPERTY || inspectFormatterRuntimeValue(value) !== null) {
          return `packaging.selection.${category}`;
        }
      }
      if (inspectFormatterRuntimeValue(selection) !== null) return 'packaging.selection';
    }

    for (const [key, field] of [
      ['scope', 'packaging.scope'],
      ['numbering', 'packaging.numbering'],
      ['groupNumbering', 'packaging.groupNumbering'],
      ['provenance', 'packaging.provenance'],
      ['omissions', 'packaging.omissions'],
      ['issues', 'packaging.issues'],
    ] as const) {
      const value = ownDataProperty(plan, key);
      if (value === MISSING_DATA_PROPERTY || inspectFormatterRuntimeValue(value) !== null) {
        return field;
      }
    }
    return 'packaging.input';
  } catch {
    return 'packaging.input';
  }
}

/**
 * Test-only fault-injection seam (Second Corrective C6). Never part of
 * `ExportPackageInput` or the packaging public surface (`./index.ts` does
 * not re-export `packageExportWithHooksForTesting`); production code always
 * calls `packageExport`, which supplies the no-op default below. It exists
 * solely so a test can force an exception at one precise, documented point -
 * immediately after a valid plan is prepared - without monkey-patching any
 * global API, to prove the outer catch path still returns the
 * already-known `warnings`/`omissions` rather than silently discarding them.
 */
export interface PackageExportInternalHooks {
  readonly afterPlanPrepared?: () => void;
}
const NO_OP_HOOKS: PackageExportInternalHooks = {};

/**
 * Build a deterministic ZIP package from an approved export plan. Typed
 * result only; hostile or malformed input never throws and never produces
 * partial ZIP bytes.
 */
export function packageExport(input: ExportPackageInput): ExportPackageResult {
  return packageExportInternal(input, NO_OP_HOOKS);
}

/** Do not import from outside test files; see `PackageExportInternalHooks` above. */
export function packageExportWithHooksForTesting(
  input: ExportPackageInput,
  hooks: PackageExportInternalHooks,
): ExportPackageResult {
  return packageExportInternal(input, hooks);
}

function packageExportInternal(
  input: ExportPackageInput,
  hooks: PackageExportInternalHooks,
): ExportPackageResult {
  // Second Corrective C6: preserved across every failure path, including the
  // outer catch - never silently reset to empty once a valid plan is known.
  let knownWarnings: readonly ValidationFailure[] = [];
  let knownOmissions: readonly ExportPlanOmission[] = [];
  try {
    // Reject throwing getters, toJSON traps, prototype pollution, cycles, sparse
    // arrays, and secret/path-shaped metadata before any property is read, using
    // the approved (widest) bounds; the bounded, caller-supplied-limits pass runs
    // again inside prepareFormatterInput below.
    if (inspectFormatterRuntimeValue(input) !== null) {
      return singleFailure('EXPORT_CORRUPT_001', preciseRuntimeFailureField(input));
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
      return singleFailure('EXPORT_CORRUPT_001', preciseRuntimeFailureField(input));
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
    knownWarnings = warnings;
    knownOmissions = plan.omissions;
    hooks.afterPlanPrepared?.();

    const scopeKindField = preciseScopeKindFieldFailure(plan);
    if (scopeKindField) {
      return failureResult(
        [registeredExportFailure('EXPORT_SCOPE_001', scopeKindField)!],
        warnings,
        plan.omissions,
      );
    }

    // Batch 10.4 packaging never implements backup or Prompt Pack behavior; a plan
    // resolved against either scope must fail closed before any content is built.
    if (plan.scope.scopeDetail === 'backup' || plan.scope.scopeDetail === 'prompt_pack') {
      return failureResult(
        [registeredExportFailure('EXPORT_SCOPE_001', 'packaging.scope')!],
        warnings,
        plan.omissions,
      );
    }

    // Second Corrective C5: `version_snapshot` is the one supported scope with
    // zero resolved sessions (EX §3/scope.ts), so there is no real
    // `SessionFingerprint.hash` this export can honestly report as
    // `sourceFingerprints.sessionFingerprint` - a `VersionSnapshot.stateHash`
    // is a whole-project state digest, not a session fingerprint, and using
    // it there would misrepresent what the field means. `ExportManifest` (a
    // frozen Batch 10.2 contract) has no session-less provenance shape to
    // fall back to, and no schema change is in scope for this corrective, so
    // packaging fails closed with the existing scope-rejection code rather
    // than fabricate or misuse a hash.
    if (plan.scope.scopeDetail === 'version_snapshot') {
      return failureResult(
        [registeredExportFailure('EXPORT_SCOPE_001', 'packaging.scope')!],
        warnings,
        plan.omissions,
      );
    }

    // Consolidated Final Corrective §5/§5.1: one typed validation entry
    // point, called once, in a fixed deterministic precedence - scope
    // policy, then scope identifier arrays, then numbering (canonical order
    // and field exactness), then group numbering, then selected Output A/B
    // linkage - so the failure a hostile plan produces never depends on
    // which check happened to run first. See `validatePackagePlanIntegrity`
    // for the full rationale of each stage.
    const integrity = validatePackagePlanIntegrity(plan, input.limits);
    if (!integrity.ok) {
      return failureResult(integrity.failures, warnings, plan.omissions);
    }
    const trustedPlan = integrity.value.plan;
    const trustedWarnings = trustedPlan.issues.filter(
      (issue) => issue.severity === ValidationSeverity.Warning,
    );

    const planned = buildPackageContentEntries(integrity.value, input.limits);
    if (!planned.ok) return failureResult(planned.failures, trustedWarnings, trustedPlan.omissions);

    const totalContentBytes = planned.entries.reduce((sum, entry) => sum + entry.byteLength, 0);
    if (
      planned.entries.length > input.limits.maxZipEntries ||
      totalContentBytes > input.limits.maxUncompressedBytes
    ) {
      return failureResult(
        [registeredExportFailure('EXPORT_STORAGE_001', 'packaging.entries')!],
        trustedWarnings,
        trustedPlan.omissions,
      );
    }

    const relativePath = (fullPath: string): string =>
      fullPath.slice(planned.projectSlug.length + 1);

    const manifest = buildExportManifest({
      validated: integrity.value,
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
        trustedWarnings,
        trustedPlan.omissions,
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
        trustedWarnings,
        trustedPlan.omissions,
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
        trustedWarnings,
        trustedPlan.omissions,
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
      return failureResult(
        [registeredExportFailure('EXPORT_ZIP_001', 'packaging.zip')!],
        trustedWarnings,
        trustedPlan.omissions,
      );
    }

    const verification = verifyPackageZip(
      zipWrite.bytes,
      allEntries.map((entry) => ({ path: entry.path, kind: entry.kind, checksum: entry.checksum })),
    );
    if (!verification.ok) {
      return failureResult(
        [registeredExportFailure('EXPORT_CORRUPT_001', `packaging.verify.${verification.reason}`)!],
        trustedWarnings,
        trustedPlan.omissions,
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
      warnings: trustedWarnings,
      omissions: trustedPlan.omissions,
    };
  } catch {
    // C6: any warnings/omissions already known from a successfully prepared
    // plan survive even an unexpected exception past that point - never
    // silently reset to empty.
    return failureResult(
      [registeredExportFailure('EXPORT_CORRUPT_001', 'packaging.input')!],
      knownWarnings,
      knownOmissions,
    );
  }
}
