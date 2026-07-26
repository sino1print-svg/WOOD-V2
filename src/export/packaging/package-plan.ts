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
 * Fifth Corrective C1: a resolved scope's `policy` flags are the allowlist
 * for which artifact *categories* may be selected at all - `output_b` and
 * `group_b` must never carry a selected Output A, `cover` must never carry
 * selected Output A/B prompts, `execution_plan` must never carry prompt
 * artifacts, and so on. `hasRelationalIntegrityViolation` below proves
 * selected artifacts are *mutually consistent*, but a single internally
 * consistent Output A (e.g. the scene's own genuine Output A record,
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
 * `hasRelationalIntegrityViolation`'s scope-membership checks use `Set`s,
 * which silently discard duplicate evidence; content construction
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
 * Consolidated Final Corrective §8.2/§8.3: `plan.numbering` must be the
 * *exact* canonical sequence the resolver itself would produce - not merely
 * mutually consistent with whatever is selected. Both `plan.numbering` and
 * `plan.scope.outputAIds`/`outputBIds` are built by the real planner via the
 * identical canonical session/scene traversal (`buildExportNumbering` /
 * `collectEntityIds`, both skipping a scene exactly when it lacks the
 * relevant output), so for a genuine plan:
 *
 * ```
 * plan.numbering.map(row => row.outputAId) === plan.scope.outputAIds
 * ```
 *
 * by length, value, and index - never sorted, never deduplicated. This one
 * exact-sequence comparison closes several previously separate gaps at
 * once: an extra/missing/duplicated numbering row (length disagrees), a
 * reordered sequence (index disagrees), and a fully bijective A-id exchange
 * between two identities while `scope.outputAIds` itself stays untouched
 * (value-at-index disagrees, even though the *set* of ids is unchanged and
 * every field is internally self-consistent). The equivalent B-sequence
 * check applies to every scope except `output_a`, whose approved planner
 * may legitimately retain a scene's real B id in `numbering.outputBId` even
 * though `output_a` deliberately resolves `scope.outputBIds` empty and
 * selects no B artifact (EX §12, output_a exception).
 */
function hasNumberingCanonicalOrderViolation(plan: ExportPlan): boolean {
  const outputAIds = plan.numbering.map((entry) => entry.outputAId);
  if (!arraysEqual(outputAIds, plan.scope.outputAIds)) return true;

  if (plan.scope.scopeDetail !== 'output_a') {
    const outputBIds = plan.numbering
      .filter(
        (entry): entry is NumberingRecord & { readonly outputBId: string } =>
          entry.outputBId !== undefined,
      )
      .map((entry) => entry.outputBId);
    if (!arraysEqual(outputBIds, plan.scope.outputBIds)) return true;
  }
  return false;
}

/**
 * Consolidated Final Corrective §8.1: every numbering row's own fields must
 * be internally well-formed, and every row must belong to the resolved
 * scope. Duplicate-identity and cross-session-leakage protection is
 * already implied by `hasNumberingCanonicalOrderViolation` (a duplicate or
 * out-of-scope row changes the exact canonical sequence), so this only
 * checks what that sequence comparison cannot see on its own: label/
 * sceneNumber format, and the `outputBId`/`outputBLabel` pairing.
 */
function hasNumberingFieldViolation(plan: ExportPlan): boolean {
  const sessionIdSet = new Set<string>(plan.scope.sessionIds);
  for (const entry of plan.numbering) {
    if (!sessionIdSet.has(entry.sessionId)) return true;
    if (!Number.isInteger(entry.sceneNumber) || entry.sceneNumber <= 0) return true;
    if (entry.outputALabel !== `${entry.sceneNumber}A`) return true;
    const hasB = entry.outputBId !== undefined;
    const hasBLabel = entry.outputBLabel !== undefined;
    if (hasB !== hasBLabel) return true;
    if (hasB && entry.outputBLabel !== `${entry.sceneNumber}B`) return true;
  }
  return false;
}

/**
 * Consolidated Final Corrective §11: every `groupNumbering` row must
 * reconcile with the resolved scope, with its own `(sessionId, sceneId)`
 * numbering row, and - when group metadata is selected - exactly with the
 * selected group's own membership. Identity is
 * `(sessionId, groupId, sceneId)`; no duplicate identity, no row outside
 * `scope.sessionIds`/`scope.groupIds`, no row for a scene outside its own
 * selected group's `sceneIds`, and exact field/label agreement with the
 * matching numbering row.
 */
function hasGroupNumberingViolation(plan: ExportPlan): boolean {
  const sessionIdSet = new Set<string>(plan.scope.sessionIds);
  const groupIdSet = new Set<string>(plan.scope.groupIds);
  const numberingByIdentity = groupByIdentity<NumberingRecord>(plan.numbering);
  const seenIdentities = new Set<string>();

  for (const row of plan.groupNumbering) {
    const identity =
      row.sessionId + IDENTITY_KEY_SEPARATOR + row.groupId + IDENTITY_KEY_SEPARATOR + row.sceneId;
    if (seenIdentities.has(identity)) return true;
    seenIdentities.add(identity);

    if (!sessionIdSet.has(row.sessionId)) return true;
    if (!groupIdSet.has(row.groupId)) return true;

    const numberingList = numberingByIdentity.get(identityKey(row.sessionId, row.sceneId)) ?? [];
    if (numberingList.length !== 1) return true;
    const numberingEntry = numberingList[0]!;
    if (row.sceneNumber !== numberingEntry.sceneNumber) return true;
    if (row.outputAId !== numberingEntry.outputAId) return true;
    const rowHasB = row.outputBId !== undefined;
    const numberingHasB = numberingEntry.outputBId !== undefined;
    if (rowHasB !== numberingHasB) return true;
    if (rowHasB && row.outputBId !== numberingEntry.outputBId) return true;

    if (!Number.isInteger(row.groupNumber) || row.groupNumber <= 0) return true;
    if (!Number.isInteger(row.groupSceneNumber) || row.groupSceneNumber <= 0) return true;
    if (row.outputALabel !== `${row.groupNumber}.${row.groupSceneNumber}-A`) return true;
    const rowHasBLabel = row.outputBLabel !== undefined;
    if (rowHasB !== rowHasBLabel) return true;
    if (rowHasB && row.outputBLabel !== `${row.groupNumber}.${row.groupSceneNumber}-B`) return true;

    const selectedGroup = plan.selection.groups.find(
      (group) => group.id === row.groupId && group.sessionId === row.sessionId,
    );
    if (selectedGroup !== undefined && !selectedGroup.sceneIds.includes(row.sceneId)) return true;
  }

  if (plan.scope.policy.groupMetadata) {
    for (const group of plan.selection.groups) {
      const expectedCount = group.sceneIds.filter((sceneId) => {
        const list = numberingByIdentity.get(identityKey(group.sessionId, sceneId)) ?? [];
        return list.length === 1;
      }).length;
      const actualCount = plan.groupNumbering.filter(
        (row) => row.sessionId === group.sessionId && row.groupId === group.id,
      ).length;
      if (actualCount !== expectedCount) return true;
    }
  }

  return false;
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
  // The resolved scope's own flat ID allowlists - computed once by
  // `resolveExportScope` directly from the source project, never touched by
  // `selection`/`numbering` construction - anchor every selected/referenced
  // output id to a real, in-scope entity. A jointly-forged id that only
  // agrees with its own numbering counterpart, never with the resolved
  // scope's ground truth, is rejected here; a *bijective* exchange of two
  // real ids between two identities is additionally impossible to reach
  // this function at all, because `hasDuplicateScopeIdentifiers` (no
  // duplicate real id in `scope.outputAIds`/`outputBIds`) combined with
  // `hasNumberingCanonicalOrderViolation` (the numbering sequence must
  // equal those same duplicate-free arrays exactly, index for index) - both
  // run earlier in `validatePackagePlanIntegrity`'s fixed precedence - only
  // let a plan reach here once every numbering row's `outputAId`/`outputBId`
  // is already provably unique and provably a real, in-scope id at its own
  // identity's exact canonical position.
  const outputAIdSet = new Set<string>(plan.scope.outputAIds);
  const outputBIdSet = new Set<string>(plan.scope.outputBIds);

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
    if (!outputBIdSet.has(outputB.id)) return true;
    if (!outputAIdSet.has(outputB.sourceOutputAId)) return true;
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
    if (!outputAIdSet.has(outputA.id)) return true;
    const numberingList = numberingByIdentity.get(key) ?? [];
    if (numberingList.length !== 1) return true;
    if (numberingList[0]!.outputAId !== outputA.id) return true;
  }

  return false;
}

export type PackagePlanValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failures: readonly ValidationFailure[] };

/**
 * Consolidated Final Corrective §5/§5.1: one typed validation entry point,
 * called in the required deterministic precedence order, replacing a
 * growing sequence of independently-invoked boolean checks. Every check
 * above remains its own narrow, unit-testable function - reused here, not
 * duplicated - but `package.ts` now calls only this single function, in
 * this one fixed order, so the failure a hostile plan produces never
 * depends on which caller happened to check what first:
 *
 * 1. scope policy (`EXPORT_SCOPE_001` / `packaging.scope.policy`);
 * 2. scope identifier arrays (`EXPORT_SCOPE_001` / `packaging.scope`);
 * 3. numbering - canonical order and field exactness (`EXPORT_LINK_001` /
 *    `packaging.numbering`);
 * 4. group numbering (`EXPORT_GROUP_001` / `packaging.groupNumbering`);
 * 5. selected Output A / Output B linkage (`EXPORT_LINK_001` /
 *    `packaging.selection.outputsB`).
 */
export function validatePackagePlanIntegrity(plan: ExportPlan): PackagePlanValidationResult {
  if (hasScopePolicyViolation(plan)) {
    return {
      ok: false,
      failures: [registeredExportFailure('EXPORT_SCOPE_001', 'packaging.scope.policy')!],
    };
  }
  if (hasDuplicateScopeIdentifiers(plan)) {
    return {
      ok: false,
      failures: [registeredExportFailure('EXPORT_SCOPE_001', 'packaging.scope')!],
    };
  }
  if (hasNumberingCanonicalOrderViolation(plan) || hasNumberingFieldViolation(plan)) {
    return {
      ok: false,
      failures: [registeredExportFailure('EXPORT_LINK_001', 'packaging.numbering')!],
    };
  }
  if (hasGroupNumberingViolation(plan)) {
    return {
      ok: false,
      failures: [registeredExportFailure('EXPORT_GROUP_001', 'packaging.groupNumbering')!],
    };
  }
  if (hasRelationalIntegrityViolation(plan)) {
    return {
      ok: false,
      failures: [registeredExportFailure('EXPORT_LINK_001', 'packaging.selection.outputsB')!],
    };
  }
  return { ok: true };
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
