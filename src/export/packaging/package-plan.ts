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

function outputSlugMap(plan: ExportPlan): Map<string, string> {
  const map = new Map<string, string>();
  for (const outputA of plan.selection.outputsA) {
    map.set(outputA.id, outputSlug(`${outputA.garment} ${outputA.view}`, outputA.id));
  }
  return map;
}

const PAIR_FILE_ELIGIBLE_SCOPES = new Set(['pair', 'group', 'session', 'complete_project', 'all']);
/** Scopes whose content policy never selects an Output A artifact for a scene that has a selected Output B - a real relationship still exists (via `sourceOutputAId`/numbering) but no A file is expected. */
const B_ONLY_SCOPES = new Set(['output_b', 'group_b']);

type OutputARecord = ExportPlan['selection']['outputsA'][number];
type OutputBRecord = ExportPlan['selection']['outputsB'][number];
type NumberingRecord = ExportPlan['numbering'][number];

// Unit separator (0x1F) - never appears in a real SessionId/SceneId - used
// only to prevent an accidental cross-identity collision when concatenating.
const IDENTITY_KEY_SEPARATOR = String.fromCharCode(0x1f);

/** `(sessionId, sceneId)` composite identity key - scene ids are only unique within a session (EX §12 Third Corrective F2). */
function identityKey(sessionId: string, sceneId: string): string {
  return sessionId + IDENTITY_KEY_SEPARATOR + sceneId;
}

function groupByIdentity<T extends { readonly sessionId: string; readonly sceneId: string }>(
  items: readonly T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = identityKey(item.sessionId, item.sceneId);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

/**
 * Fourth Corrective C1/C2: exact-cardinality, scope-aware relational
 * validation over `plan.selection.outputsA`/`outputsB`/`plan.numbering`,
 * replacing the prior first-match `.find()`-based checks (Third Corrective
 * F1/F2), which silently accepted a selected Output B moved to another
 * session/scene, a B with no matching A, duplicate selected A/B records, and
 * a valid numbering row followed by a hostile duplicate (order-dependently).
 *
 * Every identity below is grouped by the complete `(sessionId, sceneId)` key
 * before any comparison runs, so cardinality violations (more than one
 * selected A, B, or numbering row for one identity) are counted rather than
 * masked by whichever row a `.find()` happened to hit first - the result is
 * independent of array order (a valid row followed by a hostile duplicate
 * fails exactly the same way as the same two rows reversed).
 *
 * Scope-aware rules:
 * - Pair-bearing scopes (`pair`, `group`, `session`, `complete_project`,
 *   `all`): every selected Output B requires exactly one selected Output A
 *   for the same identity, exactly one numbering row, and full ID agreement
 *   among B.sourceOutputAId / A.id / numbering.outputAId / numbering.outputBId.
 * - B-only scopes (`output_b`, `group_b`): the Output A artifact is
 *   legitimately never selected, so it is not required to exist - but the
 *   selected B must still have exactly one numbering row whose
 *   outputAId/outputBId agree with B.sourceOutputAId/B.id.
 * - Every selected Output A (any scope) requires exactly one numbering row
 *   whose outputAId agrees with it - this is the A-only-scope rule
 *   (`output_a`/`group_a`) but is safe to apply universally since it is
 *   already implied for pair-bearing identities above.
 * - Every selected Output A/B must belong to `plan.scope.sessionIds`, and -
 *   when `plan.scope.sceneIds` is non-empty - to `plan.scope.sceneIds`.
 */
export function hasRelationalIntegrityViolation(plan: ExportPlan): boolean {
  const sessionIdSet = new Set<string>(plan.scope.sessionIds);
  const sceneIdSet = new Set<string>(plan.scope.sceneIds);
  const sceneScopeIsBounded = plan.scope.sceneIds.length > 0;

  const outOfScope = (sessionId: string, sceneId: string): boolean =>
    !sessionIdSet.has(sessionId) || (sceneScopeIsBounded && !sceneIdSet.has(sceneId));

  for (const outputA of plan.selection.outputsA) {
    if (outOfScope(outputA.sessionId, outputA.sceneId)) return true;
  }
  for (const outputB of plan.selection.outputsB) {
    if (outOfScope(outputB.sessionId, outputB.sceneId)) return true;
  }

  const outputsAByIdentity = groupByIdentity<OutputARecord>(plan.selection.outputsA);
  const outputsBByIdentity = groupByIdentity<OutputBRecord>(plan.selection.outputsB);
  const numberingByIdentity = groupByIdentity<NumberingRecord>(plan.numbering);

  for (const list of outputsAByIdentity.values()) {
    if (list.length > 1) return true;
  }
  for (const list of outputsBByIdentity.values()) {
    if (list.length > 1) return true;
  }

  const isPairBearing = PAIR_FILE_ELIGIBLE_SCOPES.has(plan.scope.scopeDetail);
  const isBOnly = B_ONLY_SCOPES.has(plan.scope.scopeDetail);

  for (const [key, bList] of outputsBByIdentity) {
    const outputB = bList[0]!;
    const numberingList = numberingByIdentity.get(key) ?? [];
    if (numberingList.length !== 1) return true;
    const numberingEntry = numberingList[0]!;
    if (numberingEntry.outputBId !== outputB.id) return true;
    if (numberingEntry.outputAId !== outputB.sourceOutputAId) return true;

    if (isPairBearing) {
      const aList = outputsAByIdentity.get(key) ?? [];
      if (aList.length !== 1) return true;
      const outputA = aList[0]!;
      if (outputB.sourceOutputAId !== outputA.id) return true;
      if (numberingEntry.outputAId !== outputA.id) return true;
    } else if (!isBOnly) {
      // Any non-pair-bearing, non-B-only scope should never select an
      // Output B at all under the current content-policy design; if one
      // somehow appears, treat it as relationally unverifiable and fail
      // closed rather than silently accept it.
      return true;
    }
  }

  for (const [key, aList] of outputsAByIdentity) {
    const outputA = aList[0]!;
    const numberingList = numberingByIdentity.get(key) ?? [];
    if (numberingList.length !== 1) return true;
    if (numberingList[0]!.outputAId !== outputA.id) return true;
  }

  return false;
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
 * By the time this runs, `hasRelationalIntegrityViolation` has already
 * rejected the plan outright if any identity had more than one selected A,
 * B, or numbering row (Fourth Corrective C3), so a validated identity here
 * is guaranteed to have at most one of each - this function only needs to
 * confirm the single row's own consistency, never resolve ambiguity among
 * duplicates.
 */
function shouldEmitPairFile(
  plan: ExportPlan,
  sessionId: ExportPlan['numbering'][number]['sessionId'],
  sceneId: ExportPlan['numbering'][number]['sceneId'],
): boolean {
  if (!PAIR_FILE_ELIGIBLE_SCOPES.has(plan.scope.scopeDetail)) return false;
  const outputA = plan.selection.outputsA.find(
    (item) => item.sessionId === sessionId && item.sceneId === sceneId,
  );
  const outputB = plan.selection.outputsB.find(
    (item) => item.sessionId === sessionId && item.sceneId === sceneId,
  );
  if (outputA === undefined || outputB === undefined) return false;
  if (outputB.sourceOutputAId !== outputA.id) return false;
  const numberingEntry = plan.numbering.find(
    (item) => item.sessionId === sessionId && item.sceneId === sceneId,
  );
  if (numberingEntry === undefined) return false;
  return numberingEntry.outputAId === outputA.id && numberingEntry.outputBId === outputB.id;
}

/** Builds every content file. Returns `null` on the first unrecoverable resource-limit failure. */
export function buildPackageContentEntries(
  plan: ExportPlan,
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

  if (plan.selection.project !== null) {
    const built = buildProjectJson(plan.selection.project, contentLimits);
    if (built === null) return overflow('packaging.project');
    files.push({
      relativePath: 'project/project.json',
      kind: 'project',
      format: ExportFormat.Json,
      mediaType: 'application/json',
      bytes: built.bytes,
    });
  }

  for (const version of plan.selection.versions) {
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

  for (const artwork of plan.selection.artworks) {
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

  const slugs = outputSlugMap(plan);
  let sessionIndex = 0;
  // Iterate the resolved scope's session IDs (always populated), not
  // `selection.sessions` - single-output/pair/group/cover scopes correctly omit
  // full session metadata (policy.sessionMetadata=false) while still selecting
  // outputs, groups, or a cover that belong to that session.
  for (const sessionId of plan.scope.sessionIds) {
    sessionIndex += 1;
    const sessionFolder = sessionFolderName(sessionIndex);

    const selectedSession = plan.selection.sessions.find((item) => item.id === sessionId);
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

    const executionPlan = plan.selection.executionPlans.find(
      (item) => item.sessionId === sessionId,
    );
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

    const sessionGroupPlans = plan.selection.groupPlans.filter(
      (item) => item.sessionId === sessionId,
    );
    for (const groupPlan of sessionGroupPlans) {
      files.push({
        relativePath: `${sessionFolder}/groups/${groupFileName(groupPlan.groupNumber, maxSegment)}`,
        kind: 'group_plan',
        format: ExportFormat.Txt,
        mediaType: 'text/plain;charset=utf-8',
        bytes: promptFileBytes(groupPlan.promptText),
      });
    }

    const sessionOutputsA = plan.selection.outputsA.filter((item) => item.sessionId === sessionId);
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

    const sessionOutputsB = plan.selection.outputsB.filter((item) => item.sessionId === sessionId);
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

    const sessionNumbering = plan.numbering.filter(
      (item) => item.sessionId === sessionId && shouldEmitPairFile(plan, sessionId, item.sceneId),
    );
    // Fourth Corrective C3: consume the already-validated relation directly
    // rather than an ambiguous global filter/find. `hasRelationalIntegrityViolation`
    // has already rejected any plan carrying more than one numbering row per
    // identity, so this Set can never actually drop a legitimate row - it is
    // defense-in-depth so a single validated identity can never emit more than
    // one collision-suffixed pair file even if that upstream gate regresses.
    const emittedPairIdentities = new Set<string>();
    for (const entry of sessionNumbering) {
      const identity = identityKey(entry.sessionId, entry.sceneId);
      if (emittedPairIdentities.has(identity)) continue;
      emittedPairIdentities.add(identity);
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

    const cover = plan.selection.covers.find((item) => item.sessionId === sessionId);
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

    const promptMetadata = buildPromptMetadataJson(sessionId, plan, contentLimits);
    if (promptMetadata === null) return overflow('packaging.promptMetadata');
    files.push({
      relativePath: `${sessionFolder}/metadata/prompt-metadata.json`,
      kind: 'prompt_metadata',
      format: ExportFormat.Json,
      mediaType: 'application/json',
      bytes: promptMetadata.bytes,
    });

    const validation = buildValidationJson(sessionId, plan, contentLimits);
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
    plan.selection.project?.name ?? plan.scope.projectId,
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
