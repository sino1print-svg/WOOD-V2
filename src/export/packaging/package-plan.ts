/**
 * Content-entry assembly for the ZIP tree - EX section 11/12.
 *
 * Walks the already-validated `ExportPlan` in its existing canonical order and
 * produces every content file (not `manifest.json`/`checksums.sha256`, which
 * are built afterwards from this output). Naming, slugging, path safety, and
 * collision suffixing are applied here, once, in artifact order.
 */
import { ExportFormat, type ValidationFailure } from '../../shared/domain-model';
import type { ExportPlan } from '../../shared/contracts/export-planning';
import type {
  ExportArtifactKind,
  ExportFileFormat,
  ExportSafetyLimits,
} from '../../shared/contracts/export-contracts';
import type { ExportFormatterInput, ExportFormatResult } from '../format-result';
import { formatMarkdown } from '../markdown';
import { registeredExportFailure } from '../failures';
import {
  buildArtworkMetadataJson,
  buildCoverMetadataJson,
  buildExecutionPlanText,
  buildPairExecutionMarkdown,
  buildProjectJson,
  buildPromptMetadataJson,
  buildSessionSummary,
  buildValidationJson,
  buildVersionJson,
  promptFileBytes,
  type ContentLimits,
} from './content';
import { resolveCollisions } from './collision';
import {
  groupFileName,
  jsonFileName,
  outputFileName,
  outputSlug,
  pairFileName,
  sessionFolderName,
} from './naming';
import { isSafeZipPath, truncateSegment } from './path';
import { slugify } from './slug';
import { makeEntry, type PackageEntry } from './package-entry';
import {
  validatePackagePlanIntegrity as validatePackagePlanIntegrityWithIndex,
  type PackagePlanValidationResult,
  type ValidatedPackagePlanIndex,
} from './package-plan-validation';

export type { PackagePlanValidationResult, ValidatedPackagePlanIndex };

interface PlannedFile {
  readonly relativePath: string;
  readonly kind: ExportArtifactKind;
  readonly format: ExportFileFormat;
  readonly mediaType:
    | 'text/plain;charset=utf-8'
    | 'text/markdown;charset=utf-8'
    | 'application/json';
  readonly bytes: Uint8Array;
}

export type PackagePlanResult =
  | { readonly ok: true; readonly entries: readonly PackageEntry[]; readonly projectSlug: string }
  | { readonly ok: false; readonly failures: readonly ValidationFailure[] };

function overflow(field: string): PackagePlanResult {
  return { ok: false, failures: [registeredExportFailure('EXPORT_STORAGE_001', field)!] };
}

function contentLimitsFrom(limits: ExportSafetyLimits): ContentLimits {
  return {
    maximumBytes: limits.maxArtifactBytes,
    maximumDepth: limits.maxJsonDepth,
    maximumArrayLength: limits.maxZipEntries,
  };
}

function outputSlugMap(
  plan: ExportPlan,
  validated: ValidatedPackagePlanIndex,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const sessionId of plan.scope.sessionIds) {
    for (const outputA of validated.outputsABySession.get(sessionId) ?? []) {
      map.set(outputA.id, outputSlug(`${outputA.garment} ${outputA.view}`, outputA.id));
    }
  }
  return map;
}

const PAIR_FILE_ELIGIBLE_SCOPES = new Set(['pair', 'group', 'session', 'complete_project', 'all']);

/**
 * Fifth Corrective C1: a resolved scope's `policy` flags are the allowlist
 * for which artifact *categories* may be selected at all - `output_b` and
 * `group_b` must never carry a selected Output A, `cover` must never carry
 * selected Output A/B prompts, `execution_plan` must never carry prompt
 * artifacts, and so on. Relational validation proves selected artifacts are
 * mutually consistent, but a single internally consistent Output A (e.g.
 * the scene's own genuine Output A record,
 * injected into `selection.outputsA` even though `policy.outputA` is
 * `false`) satisfies every relational check and previously slipped through.
 * The real planner (`selection.ts`) always respects these flags - a
 * genuine `createExportPlan(...)` result can never trip this check - so
 * this exists purely to fail closed on a shape-valid but policy-violating
 * (hostile) plan. `products`/`seasons`/`colors` are intentionally excluded:
 * they are supporting descriptors selected under a separate, already
 * allowlisted rule, not a `policy`-gated category.
 */
export function hasScopePolicyViolation(plan: ExportPlan): boolean {
  const policy = plan.scope.policy;
  const selection = plan.selection;
  if (!policy.projectMetadata && selection.project !== null) return true;
  if (!policy.sessionMetadata && selection.sessions.length > 0) return true;
  if (!policy.sceneMetadata && selection.scenes.length > 0) return true;
  if (!policy.outputA && selection.outputsA.length > 0) return true;
  if (!policy.outputB && selection.outputsB.length > 0) return true;
  if (!policy.groupMetadata && selection.groups.length > 0) return true;
  if (!policy.groupPlans && selection.groupPlans.length > 0) return true;
  if (!policy.executionPlans && selection.executionPlans.length > 0) return true;
  if (!policy.cover && selection.covers.length > 0) return true;
  if (!policy.artworkMetadata && selection.artworks.length > 0) return true;
  if (!policy.validationResults && selection.validationResults.length > 0) return true;
  if (!policy.versionMetadata && selection.versions.length > 0) return true;
  return false;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

/**
 * Consolidated Final Corrective §7: the resolved scope's own
 * identity-allowlist arrays must themselves be internally consistent.
 * Set-based membership checks silently discard duplicate evidence; content construction
 * (`buildPackageContentEntries`) iterates `plan.scope.sessionIds` directly,
 * so a duplicated session id there re-emits the same real session's
 * content twice under two different ordinal folders. A genuine
 * `resolveExportScope(...)` result never contains a duplicate in
 * `sessionIds`/`groupIds`/`outputAIds`/`outputBIds`/`coverIds`/`versionIds`.
 *
 * `sceneIds` cannot use a plain global `Set` check: a `SceneId` is only
 * guaranteed unique *within* its own session (EX §12), so a
 * `complete_project`/`all`-scope plan spanning two sessions that happen to
 * each name a scene the same thing legitimately produces the identical
 * string twice in this flat, session-less array (Fifth Corrective audit
 * F3/§7.3). Composite validation instead requires:
 * - single-session scopes (every scope except `complete_project`/`all`):
 *   `sceneIds` itself has no duplicate;
 * - multi-session scopes: `selection.sessions` (always populated, since
 *   these scopes' policy always selects session metadata) must list the
 *   same session ids in the same order as `scope.sessionIds`, and
 *   flattening each session's own `sceneIds` in that order must equal
 *   `scope.sceneIds` exactly - so a repeated string is only accepted when
 *   it is genuinely backed by two distinct sessions, and any extra,
 *   missing, or reordered occurrence fails.
 */
export function hasDuplicateScopeIdentifiers(plan: ExportPlan): boolean {
  const hasDuplicates = (ids: readonly string[]): boolean => new Set(ids).size !== ids.length;
  if (
    hasDuplicates(plan.scope.sessionIds) ||
    hasDuplicates(plan.scope.groupIds) ||
    hasDuplicates(plan.scope.outputAIds) ||
    hasDuplicates(plan.scope.outputBIds) ||
    hasDuplicates(plan.scope.coverIds) ||
    hasDuplicates(plan.scope.versionIds)
  ) {
    return true;
  }

  if (plan.scope.sessionIds.length <= 1) {
    return hasDuplicates(plan.scope.sceneIds);
  }

  const sessionIds = plan.selection.sessions.map((session) => session.id);
  if (!arraysEqual(sessionIds, plan.scope.sessionIds)) return true;
  const flattenedSceneIds = plan.selection.sessions.flatMap((session) => session.sceneIds);
  return !arraysEqual(flattenedSceneIds, plan.scope.sceneIds);
}

/**
 * Typed semantic boundary.  Successful validation returns the nested trusted
 * index used by all later package content construction.
 */
export function validatePackagePlanIntegrity(
  plan: ExportPlan,
  limits: ExportSafetyLimits,
): PackagePlanValidationResult {
  return validatePackagePlanIntegrityWithIndex(plan, limits);
}

/**
 * Pair-execution files must never be inferred from `plan.numbering` alone -
 * numbering always carries a scene's real `outputBId` whenever the *source*
 * scene has an Output B, regardless of whether Output B is actually selected
 * for this scope (EX §12 First Corrective F2). `output_a`, `group_a`, `cover`,
 * and `execution_plan` scopes must never leak that relationship through a
 * pair file. Every pair-file-eligible scope - including `pair` itself - may
 * only emit one where Output A and Output B are both genuinely selected for
 * that scene, Output B's `sourceOutputAId` actually points at that selected
 * Output A, and `plan.numbering` independently records the same A/B
 * relationship.
 *
 * The validated index has already proved exact cardinality and linkage, so
 * this function performs lookup only; it never re-resolves raw plan arrays.
 */
function shouldEmitPairFile(
  plan: ExportPlan,
  validated: ValidatedPackagePlanIndex,
  sessionId: ExportPlan['numbering'][number]['sessionId'],
  sceneId: ExportPlan['numbering'][number]['sceneId'],
): boolean {
  if (!PAIR_FILE_ELIGIBLE_SCOPES.has(plan.scope.scopeDetail)) return false;
  const outputA = validated.outputABySessionAndScene.get(sessionId)?.get(sceneId);
  const outputB = validated.outputBBySessionAndScene.get(sessionId)?.get(sceneId);
  if (outputA === undefined || outputB === undefined) return false;
  const numberingEntry = validated.numberingBySessionAndScene.get(sessionId)?.get(sceneId);
  if (numberingEntry === undefined) return false;
  return true;
}

/** Builds every content file. Returns `null` on the first unrecoverable resource-limit failure. */
export function buildPackageContentEntries(
  plan: ExportPlan,
  validated: ValidatedPackagePlanIndex,
  formatterInput: ExportFormatterInput,
  limits: ExportSafetyLimits,
): PackagePlanResult {
  const contentLimits = contentLimitsFrom(limits);
  const maxSegment = limits.maxPathSegment;
  const files: PlannedFile[] = [];

  const readme: ExportFormatResult = formatMarkdown(formatterInput);
  if (!readme.ok) return { ok: false, failures: readme.failures };
  files.push({
    relativePath: 'README.md',
    kind: 'readme',
    format: 'markdown',
    mediaType: 'text/markdown;charset=utf-8',
    bytes: readme.value.bytes,
  });

  if (validated.project !== null) {
    const built = buildProjectJson(validated.project, contentLimits);
    if (built === null) return overflow('packaging.project');
    files.push({
      relativePath: 'project/project.json',
      kind: 'project',
      format: ExportFormat.Json,
      mediaType: 'application/json',
      bytes: built.bytes,
    });
  }

  for (const version of validated.versionsById.values()) {
    const built = buildVersionJson(version, contentLimits);
    if (built === null) return overflow('packaging.version');
    const fileName = jsonFileName(version.versionId, maxSegment);
    files.push({
      relativePath: `project/versions/${fileName}`,
      kind: 'version_snapshot',
      format: ExportFormat.Json,
      mediaType: 'application/json',
      bytes: built.bytes,
    });
  }

  for (const artwork of validated.artworksById.values()) {
    const built = buildArtworkMetadataJson(artwork, contentLimits);
    if (built === null) return overflow('packaging.artworkMetadata');
    const fileName = jsonFileName(artwork.id, maxSegment);
    files.push({
      relativePath: `assets/artwork-metadata/${fileName}`,
      kind: 'artwork_metadata',
      format: ExportFormat.Json,
      mediaType: 'application/json',
      bytes: built.bytes,
    });
  }

  const slugs = outputSlugMap(plan, validated);
  let sessionIndex = 0;
  // Iterate the resolved scope's session IDs (always populated), not
  // `selection.sessions` - single-output/pair/group/cover scopes correctly omit
  // full session metadata (policy.sessionMetadata=false) while still selecting
  // outputs, groups, or a cover that belong to that session.
  for (const sessionId of plan.scope.sessionIds) {
    sessionIndex += 1;
    const sessionFolder = sessionFolderName(sessionIndex);

    const selectedSession = validated.sessionsById.get(sessionId);
    if (selectedSession !== undefined) {
      const summary = buildSessionSummary(selectedSession, contentLimits);
      if (summary === null) return overflow('packaging.sessionSummary');
      files.push({
        relativePath: `${sessionFolder}/session-summary.md`,
        kind: 'session_summary',
        format: 'markdown',
        mediaType: 'text/markdown;charset=utf-8',
        bytes: summary.bytes,
      });
    }

    const executionPlan = validated.executionPlansBySession.get(sessionId);
    if (executionPlan !== undefined) {
      const built = buildExecutionPlanText(executionPlan, contentLimits);
      if (built === null) return overflow('packaging.executionPlan');
      files.push({
        relativePath: `${sessionFolder}/execution-plan.txt`,
        kind: 'execution_plan',
        format: ExportFormat.Txt,
        mediaType: 'text/plain;charset=utf-8',
        bytes: built.bytes,
      });
    }

    const sessionGroupPlans = validated.groupPlansBySession.get(sessionId) ?? [];
    for (const groupPlan of sessionGroupPlans) {
      files.push({
        relativePath: `${sessionFolder}/groups/${groupFileName(groupPlan.groupNumber, maxSegment)}`,
        kind: 'group_plan',
        format: ExportFormat.Txt,
        mediaType: 'text/plain;charset=utf-8',
        bytes: promptFileBytes(groupPlan.promptText),
      });
    }

    const sessionOutputsA = validated.outputsABySession.get(sessionId) ?? [];
    for (const outputA of sessionOutputsA) {
      const slug = slugs.get(outputA.id) ?? slugify(outputA.id, outputA.id);
      files.push({
        relativePath: `${sessionFolder}/prompts/A/${outputFileName(outputA.sceneNumber, slug, 'A', maxSegment)}`,
        kind: 'prompt_a',
        format: ExportFormat.Txt,
        mediaType: 'text/plain;charset=utf-8',
        bytes: promptFileBytes(outputA.promptText),
      });
    }

    const sessionOutputsB = validated.outputsBBySession.get(sessionId) ?? [];
    for (const outputB of sessionOutputsB) {
      const slug = slugs.get(outputB.sourceOutputAId) ?? slugify(outputB.id, outputB.id);
      files.push({
        relativePath: `${sessionFolder}/prompts/B/${outputFileName(outputB.sceneNumber, slug, 'B', maxSegment)}`,
        kind: 'prompt_b',
        format: ExportFormat.Txt,
        mediaType: 'text/plain;charset=utf-8',
        bytes: promptFileBytes(outputB.promptText),
      });
    }

    const sessionNumbering = (validated.numberingBySession.get(sessionId) ?? []).filter((item) =>
      shouldEmitPairFile(plan, validated, sessionId, item.sceneId),
    );
    for (const entry of sessionNumbering) {
      const built = buildPairExecutionMarkdown(entry, contentLimits);
      if (built === null) return overflow('packaging.pairExecution');
      files.push({
        relativePath: `${sessionFolder}/prompts/pairs/${pairFileName(entry.sceneNumber, maxSegment)}`,
        kind: 'prompt_pair',
        format: 'markdown',
        mediaType: 'text/markdown;charset=utf-8',
        bytes: built.bytes,
      });
    }

    const cover = validated.coversBySession.get(sessionId);
    if (cover !== undefined) {
      files.push({
        relativePath: `${sessionFolder}/cover/cover-prompt.txt`,
        kind: 'cover_prompt',
        format: ExportFormat.Txt,
        mediaType: 'text/plain;charset=utf-8',
        bytes: promptFileBytes(cover.promptText),
      });
      const coverMetadata = buildCoverMetadataJson(cover, contentLimits);
      if (coverMetadata === null) return overflow('packaging.coverMetadata');
      files.push({
        relativePath: `${sessionFolder}/cover/cover-metadata.json`,
        kind: 'cover_metadata',
        format: ExportFormat.Json,
        mediaType: 'application/json',
        bytes: coverMetadata.bytes,
      });
    }

    const promptMetadata = buildPromptMetadataJson(
      sessionId,
      sessionOutputsA,
      sessionOutputsB,
      sessionGroupPlans,
      cover,
      contentLimits,
    );
    if (promptMetadata === null) return overflow('packaging.promptMetadata');
    files.push({
      relativePath: `${sessionFolder}/metadata/prompt-metadata.json`,
      kind: 'prompt_metadata',
      format: ExportFormat.Json,
      mediaType: 'application/json',
      bytes: promptMetadata.bytes,
    });

    const validation = buildValidationJson(
      sessionId,
      validated.validationResultsBySession.get(sessionId) ?? [],
      plan.issues,
      plan.omissions,
      plan.partial,
      contentLimits,
    );
    if (validation === null) return overflow('packaging.validation');
    files.push({
      relativePath: `${sessionFolder}/metadata/validation.json`,
      kind: 'validation',
      format: ExportFormat.Json,
      mediaType: 'application/json',
      bytes: validation.bytes,
    });
  }

  const rawProjectSlug = slugify(
    validated.project?.name ?? plan.scope.projectId,
    plan.scope.projectId,
  );
  const projectSlug = truncateSegment(rawProjectSlug, maxSegment);
  const resolvedRelativePaths = resolveCollisions(
    files.map((file) => file.relativePath),
    maxSegment,
  );
  if (resolvedRelativePaths === null) {
    return {
      ok: false,
      failures: [registeredExportFailure('EXPORT_FILENAME_001', 'packaging.collision')!],
    };
  }

  const entries: PackageEntry[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!;
    const relativePath = resolvedRelativePaths[index]!;
    const fullPath = `${projectSlug}/${relativePath}`;
    if (fullPath.length > limits.maxPathLength || !isSafeZipPath(fullPath)) {
      return {
        ok: false,
        failures: [registeredExportFailure('EXPORT_PATH_001', 'packaging.path')!],
      };
    }
    entries.push(makeEntry(fullPath, file.kind, file.format, file.mediaType, file.bytes));
  }

  return { ok: true, entries, projectSlug };
}
