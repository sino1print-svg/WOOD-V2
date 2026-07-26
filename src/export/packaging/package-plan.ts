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
 * relationship (EX §12 Second Corrective C1: a shape-valid but hostile or
 * partial plan - missing B, or B linked to a different A - must never leak a
 * pair file merely because `scopeDetail === 'pair'`).
 *
 * Every lookup below is keyed on the complete `(sessionId, sceneId)` identity,
 * never `sceneId` alone (EX §12 Third Corrective F2): scene IDs are only
 * guaranteed unique within a session, so a shape-valid hostile plan that
 * reuses a scene ID across two sessions must never let one session's real
 * Output A/B or numbering row authorize a pair file in another session.
 */
const PAIR_FILE_ELIGIBLE_SCOPES = new Set(['pair', 'group', 'session', 'complete_project', 'all']);

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

/**
 * Third Corrective F1: a relationally-corrupt plan must fail the whole
 * packaging operation, not merely suppress `prompt_pair` while still
 * emitting an Output B prompt under a false source relationship. For every
 * selected Output B whose (sessionId, sceneId) also has a selected Output A
 * (scopes that never select Output A for that scene - e.g. `output_b`,
 * `group_b` - are unaffected, since there is nothing to mismatch against),
 * `outputB.sourceOutputAId` must equal that Output A's id, and
 * `plan.numbering` must independently corroborate the same (outputAId,
 * outputBId) pair for that exact (sessionId, sceneId). Reuses this same
 * complete-identity matching (never `sceneId` alone) as `shouldEmitPairFile`.
 */
export function hasBrokenOutputLinkage(plan: ExportPlan): boolean {
  for (const outputB of plan.selection.outputsB) {
    const outputA = plan.selection.outputsA.find(
      (item) => item.sessionId === outputB.sessionId && item.sceneId === outputB.sceneId,
    );
    if (outputA === undefined) continue;
    if (outputB.sourceOutputAId !== outputA.id) return true;
    const numberingEntry = plan.numbering.find(
      (item) => item.sessionId === outputB.sessionId && item.sceneId === outputB.sceneId,
    );
    if (numberingEntry === undefined) return true;
    if (numberingEntry.outputAId !== outputA.id || numberingEntry.outputBId !== outputB.id) {
      return true;
    }
  }
  return false;
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
