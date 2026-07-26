/**
 * Content-entry assembly for the ZIP tree - EX section 11/12.
 *
 * Walks the already-validated `ExportPlan` in its existing canonical order and
 * produces every content file (not `manifest.json`/`checksums.sha256`, which
 * are built afterwards from this output). Naming, slugging, path safety, and
 * collision suffixing are applied here, once, in artifact order.
 */
import {
  ExportFormat,
  type GroupId,
  type SceneId,
  type SessionId,
  type ValidationFailure,
} from '../../shared/domain-model';
import type {
  ExportGroupNumberingEntry,
  ExportNumberingEntry,
  ExportPlan,
  ExportSelectedGroup,
  ExportSelectedOutputA,
  ExportSelectedOutputB,
} from '../../shared/contracts/export-planning';
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

/** Scopes whose content policy may legitimately select both a scene's Output A and Output B together, so a matching pair-execution file is expected. */
const PAIR_FILE_ELIGIBLE_SCOPES = new Set(['pair', 'group', 'session', 'complete_project', 'all']);

type NumberingRecord = ExportPlan['numbering'][number];

/**
 * Consolidated Final Deficiency Closure §7: every selected Output A whose
 * own `sourceOutputAId` an in-scope, pair-bearing Output B must reference,
 * exactly as recorded by `numberingBySessionAndScene`.
 *
 * Frozen typed index (§3) handed to `buildPackageContentEntries` and to the
 * pair-file eligibility rule - genuine nested `Map`s, keyed by the complete
 * `(sessionId, sceneId)`/`(sessionId, groupId)` identity, never a
 * string-concatenated composite key ("no separator character may be assumed
 * impossible inside an id" - Deficiency Closure §3). Consuming these maps
 * after validation means no downstream step ever re-resolves identity or
 * cardinality by re-scanning the raw, untrusted plan arrays.
 */
export interface ValidatedPackagePlanIndex {
  readonly numberingBySessionAndScene: ReadonlyMap<
    SessionId,
    ReadonlyMap<SceneId, ExportNumberingEntry>
  >;
  readonly outputABySessionAndScene: ReadonlyMap<
    SessionId,
    ReadonlyMap<SceneId, ExportSelectedOutputA>
  >;
  readonly outputBBySessionAndScene: ReadonlyMap<
    SessionId,
    ReadonlyMap<SceneId, ExportSelectedOutputB>
  >;
  readonly groupsBySessionAndId: ReadonlyMap<SessionId, ReadonlyMap<GroupId, ExportSelectedGroup>>;
  readonly groupNumberingBySessionAndGroup: ReadonlyMap<
    SessionId,
    ReadonlyMap<GroupId, readonly ExportGroupNumberingEntry[]>
  >;
}

export type PackagePlanValidationResult =
  | { readonly ok: true; readonly value: ValidatedPackagePlanIndex }
  | { readonly ok: false; readonly failures: readonly ValidationFailure[] };

function scopeFailure(field: string): PackagePlanValidationResult {
  return { ok: false, failures: [registeredExportFailure('EXPORT_SCOPE_001', field)!] };
}

function linkFailure(field: string): PackagePlanValidationResult {
  return { ok: false, failures: [registeredExportFailure('EXPORT_LINK_001', field)!] };
}

function groupFailure(field: string): PackagePlanValidationResult {
  return { ok: false, failures: [registeredExportFailure('EXPORT_GROUP_001', field)!] };
}

/**
 * Fifth Corrective C1: a resolved scope's `policy` flags are the allowlist
 * for which artifact *categories* may be selected at all - `output_b` and
 * `group_b` must never carry a selected Output A, `cover` must never carry
 * selected Output A/B prompts, `execution_plan` must never carry prompt
 * artifacts, and so on. The real planner (`selection.ts`) always respects
 * these flags - a genuine `createExportPlan(...)` result can never trip this
 * check - so this exists purely to fail closed on a shape-valid but
 * policy-violating (hostile) plan. `products`/`seasons`/`colors` are
 * intentionally excluded: they are supporting descriptors selected under a
 * separate, already allowlisted rule, not a `policy`-gated category.
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
 * identity-allowlist arrays must themselves be internally consistent. A
 * genuine `resolveExportScope(...)` result never contains a duplicate in
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
 *
 * Kept as its own boolean-returning, independently unit-tested export
 * (unchanged core logic - the audit found only the *orchestrator's* field
 * reporting too coarse, never this function's own correctness); the
 * deficiency-closure precise-field version lives in `validateScopeArrays`
 * below, which reuses this same duplicate-detection rule but also reports
 * exactly which array failed and returns the canonical session/scene
 * identity map the numbering stage needs.
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

type ScopeArrayResult =
  | { readonly ok: true; readonly allowedScenesBySession: Map<SessionId, Set<SceneId>> }
  | { readonly ok: false; readonly field: string };

/**
 * Deficiency Closure §4/§5: the precise per-array counterpart of
 * `hasDuplicateScopeIdentifiers` above - identical duplicate-detection rule,
 * but reports exactly which scope array failed (never one generic
 * `packaging.scope` field), and builds the canonical
 * `Map<SessionId, Set<SceneId>>` of every scene id genuinely valid for its
 * exact session - the "allowed identity" map §5 requires be built *before*
 * numbering validation runs, so a numbering row naming a real, in-scope
 * session but a fabricated (or cross-session) scene id is rejected on its
 * own, independently of whether the row's `outputAId`/`outputBId` sequence
 * happens to still agree with `scope.outputAIds`/`outputBIds`.
 */
function validateScopeArrays(plan: ExportPlan): ScopeArrayResult {
  const hasDuplicates = (ids: readonly string[]): boolean => new Set(ids).size !== ids.length;

  if (hasDuplicates(plan.scope.sessionIds))
    return { ok: false, field: 'packaging.scope.sessionIds' };
  if (hasDuplicates(plan.scope.groupIds)) return { ok: false, field: 'packaging.scope.groupIds' };

  const allowedScenesBySession = new Map<SessionId, Set<SceneId>>();
  if (plan.scope.sessionIds.length <= 1) {
    if (hasDuplicates(plan.scope.sceneIds)) return { ok: false, field: 'packaging.scope.sceneIds' };
    const onlySessionId = plan.scope.sessionIds[0];
    if (onlySessionId !== undefined) {
      allowedScenesBySession.set(onlySessionId, new Set(plan.scope.sceneIds));
    }
  } else {
    const selectedSessionIds = plan.selection.sessions.map((session) => session.id);
    if (!arraysEqual(selectedSessionIds, plan.scope.sessionIds)) {
      return { ok: false, field: 'packaging.scope.sceneIds' };
    }
    const flattenedSceneIds = plan.selection.sessions.flatMap((session) => session.sceneIds);
    if (!arraysEqual(flattenedSceneIds, plan.scope.sceneIds)) {
      return { ok: false, field: 'packaging.scope.sceneIds' };
    }
    for (const session of plan.selection.sessions) {
      allowedScenesBySession.set(session.id, new Set(session.sceneIds));
    }
  }

  if (hasDuplicates(plan.scope.outputAIds))
    return { ok: false, field: 'packaging.scope.outputAIds' };
  if (hasDuplicates(plan.scope.outputBIds))
    return { ok: false, field: 'packaging.scope.outputBIds' };
  if (hasDuplicates(plan.scope.coverIds)) return { ok: false, field: 'packaging.scope.coverIds' };
  if (hasDuplicates(plan.scope.versionIds))
    return { ok: false, field: 'packaging.scope.versionIds' };

  return { ok: true, allowedScenesBySession };
}

type NumberingIndexResult =
  | {
      readonly ok: true;
      readonly numberingBySessionAndScene: Map<SessionId, Map<SceneId, ExportNumberingEntry>>;
    }
  | { readonly ok: false };

/**
 * Deficiency Closure §5/F3: every numbering row must belong to a real,
 * in-scope session (from `allowedScenesBySession`) *and* to a scene genuinely
 * valid for that exact session - checked independently of the canonical A/B
 * id-sequence comparison below, so a row naming a fabricated scene, or
 * reusing another row's `(sessionId, sceneId)` identity, is rejected even
 * when the dependent selected artifacts for that row have been stripped and
 * the id sequence otherwise still lines up with `scope.outputAIds`
 * (Independent Audit F3 - both reproductions relied on exactly this gap).
 *
 * Canonical order (§8.2/§8.3, unchanged from the Consolidated Final
 * Corrective): `plan.numbering` must be the *exact* sequence the resolver
 * itself would produce, not merely mutually consistent with whatever is
 * selected - `plan.numbering.map(row => row.outputAId)` must equal
 * `plan.scope.outputAIds` by length, value, and index; the equivalent
 * B-sequence check applies to every scope except `output_a`, whose approved
 * planner may legitimately retain a scene's real B id in
 * `numbering.outputBId` even though `output_a` deliberately resolves
 * `scope.outputBIds` empty and selects no B artifact (EX §12).
 */
function validateNumbering(
  plan: ExportPlan,
  allowedScenesBySession: ReadonlyMap<SessionId, ReadonlySet<SceneId>>,
): NumberingIndexResult {
  const numberingBySessionAndScene = new Map<SessionId, Map<SceneId, ExportNumberingEntry>>();

  for (const entry of plan.numbering) {
    const allowedScenes = allowedScenesBySession.get(entry.sessionId);
    if (allowedScenes === undefined || !allowedScenes.has(entry.sceneId)) return { ok: false };

    let bySceneId = numberingBySessionAndScene.get(entry.sessionId);
    if (!bySceneId) {
      bySceneId = new Map<SceneId, ExportNumberingEntry>();
      numberingBySessionAndScene.set(entry.sessionId, bySceneId);
    }
    if (bySceneId.has(entry.sceneId)) return { ok: false };

    if (!Number.isInteger(entry.sceneNumber) || entry.sceneNumber <= 0) return { ok: false };
    if (entry.outputALabel !== `${entry.sceneNumber}A`) return { ok: false };
    const hasB = entry.outputBId !== undefined;
    const hasBLabel = entry.outputBLabel !== undefined;
    if (hasB !== hasBLabel) return { ok: false };
    if (hasB && entry.outputBLabel !== `${entry.sceneNumber}B`) return { ok: false };

    bySceneId.set(entry.sceneId, entry);
  }

  const outputAIds = plan.numbering.map((entry) => entry.outputAId);
  if (!arraysEqual(outputAIds, plan.scope.outputAIds)) return { ok: false };

  if (plan.scope.scopeDetail !== 'output_a') {
    const outputBIds = plan.numbering
      .filter(
        (entry): entry is NumberingRecord & { readonly outputBId: string } =>
          entry.outputBId !== undefined,
      )
      .map((entry) => entry.outputBId);
    if (!arraysEqual(outputBIds, plan.scope.outputBIds)) return { ok: false };
  }

  return { ok: true, numberingBySessionAndScene };
}

type GroupNumberingIndexResult =
  | {
      readonly ok: true;
      readonly groupsBySessionAndId: Map<SessionId, Map<GroupId, ExportSelectedGroup>>;
      readonly groupNumberingBySessionAndGroup: Map<
        SessionId,
        Map<GroupId, ExportGroupNumberingEntry[]>
      >;
    }
  | { readonly ok: false };

function groupNumberingRowsEqual(
  a: ExportGroupNumberingEntry,
  b: ExportGroupNumberingEntry,
): boolean {
  return (
    a.sessionId === b.sessionId &&
    a.groupId === b.groupId &&
    a.groupNumber === b.groupNumber &&
    a.groupSceneNumber === b.groupSceneNumber &&
    a.sceneId === b.sceneId &&
    a.sceneNumber === b.sceneNumber &&
    a.outputAId === b.outputAId &&
    a.outputALabel === b.outputALabel &&
    a.outputBId === b.outputBId &&
    a.outputBLabel === b.outputBLabel
  );
}

/**
 * Deficiency Closure §9/F7: a `groupNumbering` row's own fields must never
 * be checked only against *themselves* - the Independent Audit proved a
 * hostile `groupNumber`, a hostile `groupSceneNumber`, and a full physical
 * row reversal all pass a self-consistency check (labels updated to agree
 * with whatever hostile ordinal was chosen) while still reading as
 * `{ok:true}`. Whenever authoritative group metadata is actually selected
 * (`policy.groupMetadata`), derive the *entire expected ordered row
 * sequence* independently, from each selected group's own authoritative
 * `groupNumber` and its exact `sceneIds` order (never from
 * `plan.groupNumbering` itself), and require the full sequence to match
 * exactly - length, every field, and position. "Count equality alone is
 * insufficient" (§9): a physical reversal of two otherwise-valid rows has
 * the same count and the same per-row self-consistency, but disagrees with
 * the derived sequence at both positions.
 *
 * A resolved scope's `groupIds`/`groupNumbering` are computed structurally
 * (EX §12), independent of `policy.groupMetadata` - `execution_plan` scope
 * is the one case where real, non-empty `groupNumbering` rows exist (the
 * README documents them) while `policy.groupMetadata` is false and
 * `selection.groups` is therefore empty by design. There is no authoritative
 * source to derive an expected sequence from in that case, so this falls
 * back to per-row scope-membership, duplicate-identity, and numbering-
 * linkage/self-consistency checks - the same defense-in-depth the
 * pre-deficiency-closure validator always ran unconditionally.
 */
function validateGroupNumbering(
  plan: ExportPlan,
  sessionIdSet: ReadonlySet<SessionId>,
  groupIdSet: ReadonlySet<GroupId>,
  numberingBySessionAndScene: ReadonlyMap<SessionId, ReadonlyMap<SceneId, ExportNumberingEntry>>,
): GroupNumberingIndexResult {
  const groupsBySessionAndId = new Map<SessionId, Map<GroupId, ExportSelectedGroup>>();
  for (const group of plan.selection.groups) {
    if (!sessionIdSet.has(group.sessionId) || !groupIdSet.has(group.id)) return { ok: false };
    let bySessionGroup = groupsBySessionAndId.get(group.sessionId);
    if (!bySessionGroup) {
      bySessionGroup = new Map<GroupId, ExportSelectedGroup>();
      groupsBySessionAndId.set(group.sessionId, bySessionGroup);
    }
    if (bySessionGroup.has(group.id)) return { ok: false };
    bySessionGroup.set(group.id, group);
  }

  if (plan.scope.policy.groupMetadata) {
    const expectedRows: ExportGroupNumberingEntry[] = [];
    for (const bySessionGroup of groupsBySessionAndId.values()) {
      for (const group of bySessionGroup.values()) {
        let groupSceneNumber = 0;
        for (const sceneId of group.sceneIds) {
          const numberingEntry = numberingBySessionAndScene.get(group.sessionId)?.get(sceneId);
          if (numberingEntry === undefined) continue;
          groupSceneNumber += 1;
          expectedRows.push({
            sessionId: group.sessionId,
            groupId: group.id,
            groupNumber: group.groupNumber,
            groupSceneNumber,
            sceneId,
            sceneNumber: numberingEntry.sceneNumber,
            outputAId: numberingEntry.outputAId,
            outputALabel: `${group.groupNumber}.${groupSceneNumber}-A`,
            ...(numberingEntry.outputBId !== undefined
              ? {
                  outputBId: numberingEntry.outputBId,
                  outputBLabel: `${group.groupNumber}.${groupSceneNumber}-B`,
                }
              : {}),
          });
        }
      }
    }

    if (plan.groupNumbering.length !== expectedRows.length) return { ok: false };
    for (let index = 0; index < expectedRows.length; index += 1) {
      if (!groupNumberingRowsEqual(plan.groupNumbering[index]!, expectedRows[index]!)) {
        return { ok: false };
      }
    }
  } else {
    const seenScenesByGroup = new Map<SessionId, Map<GroupId, Set<SceneId>>>();
    for (const row of plan.groupNumbering) {
      if (!sessionIdSet.has(row.sessionId) || !groupIdSet.has(row.groupId)) return { ok: false };

      let byGroup = seenScenesByGroup.get(row.sessionId);
      if (!byGroup) {
        byGroup = new Map<GroupId, Set<SceneId>>();
        seenScenesByGroup.set(row.sessionId, byGroup);
      }
      let scenes = byGroup.get(row.groupId);
      if (!scenes) {
        scenes = new Set<SceneId>();
        byGroup.set(row.groupId, scenes);
      }
      if (scenes.has(row.sceneId)) return { ok: false };
      scenes.add(row.sceneId);

      const numberingEntry = numberingBySessionAndScene.get(row.sessionId)?.get(row.sceneId);
      if (numberingEntry === undefined) return { ok: false };
      if (row.sceneNumber !== numberingEntry.sceneNumber) return { ok: false };
      if (row.outputAId !== numberingEntry.outputAId) return { ok: false };
      const rowHasB = row.outputBId !== undefined;
      const numberingHasB = numberingEntry.outputBId !== undefined;
      if (rowHasB !== numberingHasB) return { ok: false };
      if (rowHasB && row.outputBId !== numberingEntry.outputBId) return { ok: false };

      if (!Number.isInteger(row.groupNumber) || row.groupNumber <= 0) return { ok: false };
      if (!Number.isInteger(row.groupSceneNumber) || row.groupSceneNumber <= 0)
        return { ok: false };
      if (row.outputALabel !== `${row.groupNumber}.${row.groupSceneNumber}-A`) return { ok: false };
      const rowHasBLabel = row.outputBLabel !== undefined;
      if (rowHasB !== rowHasBLabel) return { ok: false };
      if (rowHasB && row.outputBLabel !== `${row.groupNumber}.${row.groupSceneNumber}-B`) {
        return { ok: false };
      }
    }
  }

  const groupNumberingBySessionAndGroup = new Map<
    SessionId,
    Map<GroupId, ExportGroupNumberingEntry[]>
  >();
  for (const row of plan.groupNumbering) {
    let bySessionGroup = groupNumberingBySessionAndGroup.get(row.sessionId);
    if (!bySessionGroup) {
      bySessionGroup = new Map<GroupId, ExportGroupNumberingEntry[]>();
      groupNumberingBySessionAndGroup.set(row.sessionId, bySessionGroup);
    }
    let rows = bySessionGroup.get(row.groupId);
    if (!rows) {
      rows = [];
      bySessionGroup.set(row.groupId, rows);
    }
    rows.push(row);
  }

  return { ok: true, groupsBySessionAndId, groupNumberingBySessionAndGroup };
}

type OutputAIndexResult =
  | {
      readonly ok: true;
      readonly outputABySessionAndScene: Map<SessionId, Map<SceneId, ExportSelectedOutputA>>;
    }
  | { readonly ok: false };

/**
 * Deficiency Closure §7/F5: for every selected Output A, require exact
 * agreement with its own numbering row's `outputAId`, `sceneNumber`, and
 * `outputALabel` - not merely the id (the Independent Audit reproduced a
 * selected A relabeled to a different scene number/label entirely, with no
 * other field disagreeing, previously accepted). Enforce exact
 * one-per-identity and one-identity-per-id.
 *
 * Enforce canonical order (§7): `selection.outputsA.map(x => x.id)` must
 * equal the ordered subsequence of `scope.outputAIds` that survives
 * approved-omission filtering. `plan.numbering` is, by this point, already
 * proven to equal `scope.outputAIds` exactly (the numbering stage above), so
 * walking `plan.numbering` in order and dropping any identity with a
 * matching `output_a` omission produces exactly that expected subsequence -
 * this single order comparison also closes F4/§6 (a missing selected
 * artifact with no omission evidence changes the expected sequence's length
 * or values, and "do not treat absence as implicit omission" holds because
 * omission status is read only from `plan.omissions`, never inferred from
 * absence itself).
 */
function validateSelectedOutputA(
  plan: ExportPlan,
  numberingBySessionAndScene: ReadonlyMap<SessionId, ReadonlyMap<SceneId, ExportNumberingEntry>>,
): OutputAIndexResult {
  if (!plan.scope.policy.outputA) {
    return { ok: true, outputABySessionAndScene: new Map() };
  }

  const outputAIdSet = new Set<string>(plan.scope.outputAIds);
  const claimedIds = new Set<string>();
  const outputABySessionAndScene = new Map<SessionId, Map<SceneId, ExportSelectedOutputA>>();

  for (const outputA of plan.selection.outputsA) {
    if (!outputAIdSet.has(outputA.id) || claimedIds.has(outputA.id)) return { ok: false };
    claimedIds.add(outputA.id);

    let bySceneId = outputABySessionAndScene.get(outputA.sessionId);
    if (!bySceneId) {
      bySceneId = new Map<SceneId, ExportSelectedOutputA>();
      outputABySessionAndScene.set(outputA.sessionId, bySceneId);
    }
    if (bySceneId.has(outputA.sceneId)) return { ok: false };

    const numberingEntry = numberingBySessionAndScene.get(outputA.sessionId)?.get(outputA.sceneId);
    if (numberingEntry === undefined) return { ok: false };
    if (numberingEntry.outputAId !== outputA.id) return { ok: false };
    if (numberingEntry.sceneNumber !== outputA.sceneNumber) return { ok: false };
    if (numberingEntry.outputALabel !== outputA.label) return { ok: false };

    bySceneId.set(outputA.sceneId, outputA);
  }

  const omittedOutputA = new Set(
    plan.omissions
      .filter((omission) => omission.artifactKind === 'output_a')
      .map((omission) => omission.entityId),
  );
  const expectedOrder = plan.numbering
    .filter((entry) => !omittedOutputA.has(`${entry.sceneId}:output_a`))
    .map((entry) => entry.outputAId);
  if (
    !arraysEqual(
      plan.selection.outputsA.map((outputA) => outputA.id),
      expectedOrder,
    )
  ) {
    return { ok: false };
  }

  return { ok: true, outputABySessionAndScene };
}

type OutputBIndexResult =
  | {
      readonly ok: true;
      readonly outputBBySessionAndScene: Map<SessionId, Map<SceneId, ExportSelectedOutputB>>;
    }
  | { readonly ok: false };

/**
 * Deficiency Closure §8/F6: mirrors `validateSelectedOutputA` for Output B -
 * exact agreement with the numbering row's `outputBId`, `sourceOutputAId`,
 * `sceneNumber`, `outputBLabel`, and `outputALabel` (as `sourceOutputALabel`)
 * - plus canonical order via the same omission-aware numbering walk. Skipped
 * entirely when `policy.outputB` is false (the frozen `output_a`/`group_a`
 * exception - `selection.outputsB` is already forced empty by
 * `hasScopePolicyViolation`, and `scope.outputBIds`/`numbering.outputBId` may
 * still legitimately carry real, structurally-present ids that this scope
 * never selects).
 *
 * When `policy.outputA` is also true (every pair-bearing scope), additionally
 * require the paired selected Output A to actually exist and agree with the
 * selected B's own `sourceOutputAId` - closing the same gap the pre-audit
 * `hasRelationalIntegrityViolation` covered via its `isPairBearing` branch,
 * now expressed against the already-validated Output A index instead of a
 * second raw-array scan.
 */
function validateSelectedOutputB(
  plan: ExportPlan,
  numberingBySessionAndScene: ReadonlyMap<SessionId, ReadonlyMap<SceneId, ExportNumberingEntry>>,
  outputABySessionAndScene: ReadonlyMap<SessionId, ReadonlyMap<SceneId, ExportSelectedOutputA>>,
): OutputBIndexResult {
  if (!plan.scope.policy.outputB) {
    return { ok: true, outputBBySessionAndScene: new Map() };
  }

  const outputBIdSet = new Set<string>(plan.scope.outputBIds);
  const claimedIds = new Set<string>();
  const claimedSourceIds = new Set<string>();
  const outputBBySessionAndScene = new Map<SessionId, Map<SceneId, ExportSelectedOutputB>>();
  const requireOutputA = plan.scope.policy.outputA;

  for (const outputB of plan.selection.outputsB) {
    if (!outputBIdSet.has(outputB.id) || claimedIds.has(outputB.id)) return { ok: false };
    if (claimedSourceIds.has(outputB.sourceOutputAId)) return { ok: false };
    claimedIds.add(outputB.id);
    claimedSourceIds.add(outputB.sourceOutputAId);

    let bySceneId = outputBBySessionAndScene.get(outputB.sessionId);
    if (!bySceneId) {
      bySceneId = new Map<SceneId, ExportSelectedOutputB>();
      outputBBySessionAndScene.set(outputB.sessionId, bySceneId);
    }
    if (bySceneId.has(outputB.sceneId)) return { ok: false };

    const numberingEntry = numberingBySessionAndScene.get(outputB.sessionId)?.get(outputB.sceneId);
    if (numberingEntry === undefined || numberingEntry.outputBId === undefined)
      return { ok: false };
    if (numberingEntry.outputBId !== outputB.id) return { ok: false };
    if (numberingEntry.outputAId !== outputB.sourceOutputAId) return { ok: false };
    if (numberingEntry.sceneNumber !== outputB.sceneNumber) return { ok: false };
    if (numberingEntry.outputBLabel !== outputB.label) return { ok: false };
    if (numberingEntry.outputALabel !== outputB.sourceOutputALabel) return { ok: false };

    if (requireOutputA) {
      const pairedOutputA = outputABySessionAndScene.get(outputB.sessionId)?.get(outputB.sceneId);
      if (pairedOutputA === undefined || pairedOutputA.id !== outputB.sourceOutputAId) {
        return { ok: false };
      }
    }

    bySceneId.set(outputB.sceneId, outputB);
  }

  const omittedOutputB = new Set(
    plan.omissions
      .filter((omission) => omission.artifactKind === 'output_b')
      .map((omission) => omission.entityId),
  );
  const expectedOrder = plan.numbering
    .filter((entry): entry is NumberingRecord & { readonly outputBId: string } => {
      if (entry.outputBId === undefined) return false;
      return !omittedOutputB.has(entry.outputBId);
    })
    .map((entry) => entry.outputBId);
  if (
    !arraysEqual(
      plan.selection.outputsB.map((outputB) => outputB.id),
      expectedOrder,
    )
  ) {
    return { ok: false };
  }

  return { ok: true, outputBBySessionAndScene };
}

/**
 * Deficiency Closure §3/§4/§5: one typed validation entry point, called in
 * the required deterministic precedence order - (1) scope policy, (2) scope
 * identifier arrays with a precise per-array failure field, (3) numbering -
 * identity, scene membership, canonical order, and field exactness, (4)
 * group numbering exactness against authoritative group metadata, (5)
 * selected Output A field/order reconciliation, (6) selected Output B
 * field/order reconciliation - so the failure a hostile plan produces never
 * depends on which check happened to run first, and an Output A problem is
 * never reported under the Output B field (or vice versa).
 *
 * On success, returns the frozen `ValidatedPackagePlanIndex` - genuine
 * nested `Map`s built once, during validation, and handed unchanged to
 * `buildPackageContentEntries` - so content construction never re-derives
 * identity or cardinality from the raw, already-validated plan arrays.
 */
export function validatePackagePlanIntegrity(plan: ExportPlan): PackagePlanValidationResult {
  if (hasScopePolicyViolation(plan)) {
    return scopeFailure('packaging.scope.policy');
  }

  const scopeArrays = validateScopeArrays(plan);
  if (!scopeArrays.ok) return scopeFailure(scopeArrays.field);

  const numberingIndex = validateNumbering(plan, scopeArrays.allowedScenesBySession);
  if (!numberingIndex.ok) return linkFailure('packaging.numbering');

  const sessionIdSet = new Set<SessionId>(plan.scope.sessionIds);
  const groupIdSet = new Set<GroupId>(plan.scope.groupIds);
  const groupNumberingIndex = validateGroupNumbering(
    plan,
    sessionIdSet,
    groupIdSet,
    numberingIndex.numberingBySessionAndScene,
  );
  if (!groupNumberingIndex.ok) return groupFailure('packaging.groupNumbering');

  const outputAIndex = validateSelectedOutputA(plan, numberingIndex.numberingBySessionAndScene);
  if (!outputAIndex.ok) return linkFailure('packaging.selection.outputsA');

  const outputBIndex = validateSelectedOutputB(
    plan,
    numberingIndex.numberingBySessionAndScene,
    outputAIndex.outputABySessionAndScene,
  );
  if (!outputBIndex.ok) return linkFailure('packaging.selection.outputsB');

  return {
    ok: true,
    value: {
      numberingBySessionAndScene: numberingIndex.numberingBySessionAndScene,
      outputABySessionAndScene: outputAIndex.outputABySessionAndScene,
      outputBBySessionAndScene: outputBIndex.outputBBySessionAndScene,
      groupsBySessionAndId: groupNumberingIndex.groupsBySessionAndId,
      groupNumberingBySessionAndGroup: groupNumberingIndex.groupNumberingBySessionAndGroup,
    },
  };
}

/** Builds every content file. Returns `null` on the first unrecoverable resource-limit failure. */
export function buildPackageContentEntries(
  plan: ExportPlan,
  formatterInput: ExportFormatterInput,
  limits: ExportSafetyLimits,
  index: ValidatedPackagePlanIndex,
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

    // Deficiency Closure §3: driven from the already-validated
    // `numberingBySessionAndScene`/`outputABySessionAndScene`/
    // `outputBBySessionAndScene` maps built by `validatePackagePlanIntegrity`
    // - never a fresh `.find()`/`.filter()` scan of the raw, untrusted
    // `plan.selection` arrays. Map insertion order mirrors the canonical
    // per-session scene order (`plan.numbering` is itself canonical, proven
    // by the numbering stage), so iterating this session's numbering rows in
    // order reproduces the same scene-number ordering the prior `.filter()`
    // calls relied on.
    const sessionNumbering = [...(index.numberingBySessionAndScene.get(sessionId)?.values() ?? [])];
    const sessionOutputA = index.outputABySessionAndScene.get(sessionId);
    const sessionOutputB = index.outputBBySessionAndScene.get(sessionId);

    for (const entry of sessionNumbering) {
      const outputA = sessionOutputA?.get(entry.sceneId);
      if (outputA === undefined) continue;
      const slug = slugs.get(outputA.id) ?? slugify(outputA.id, outputA.id);
      files.push({
        relativePath: `${sessionFolder}/prompts/A/${outputFileName(outputA.sceneNumber, slug, 'A', maxSegment)}`,
        kind: 'prompt_a',
        format: ExportFormat.Txt,
        mediaType: 'text/plain;charset=utf-8',
        bytes: promptFileBytes(outputA.promptText),
      });
    }

    for (const entry of sessionNumbering) {
      const outputB = sessionOutputB?.get(entry.sceneId);
      if (outputB === undefined) continue;
      const slug = slugs.get(outputB.sourceOutputAId) ?? slugify(outputB.id, outputB.id);
      files.push({
        relativePath: `${sessionFolder}/prompts/B/${outputFileName(outputB.sceneNumber, slug, 'B', maxSegment)}`,
        kind: 'prompt_b',
        format: ExportFormat.Txt,
        mediaType: 'text/plain;charset=utf-8',
        bytes: promptFileBytes(outputB.promptText),
      });
    }

    // Deficiency Closure §3: replaces `shouldEmitPairFile`, which re-ran
    // `.find()` against the untrusted raw plan on every call. A pair file is
    // eligible for this scope, and both a selected Output A and a selected
    // Output B already independently validated (exact id/scene-number/label
    // agreement with the same numbering row - `validateSelectedOutputB`
    // additionally required the paired A to exist whenever `policy.outputA`
    // holds) are enough to emit it; no further re-resolution against
    // `plan.selection`/`plan.numbering` is needed or performed.
    if (PAIR_FILE_ELIGIBLE_SCOPES.has(plan.scope.scopeDetail)) {
      for (const entry of sessionNumbering) {
        const outputA = sessionOutputA?.get(entry.sceneId);
        const outputB = sessionOutputB?.get(entry.sceneId);
        if (outputA === undefined || outputB === undefined) continue;
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
  for (let index2 = 0; index2 < files.length; index2 += 1) {
    const file = files[index2]!;
    const relativePath = resolvedRelativePaths[index2]!;
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
