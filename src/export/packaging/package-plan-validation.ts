/**
 * Semantic package-plan validation and trusted lookup construction.
 *
 * This module is the sole boundary between the shape-valid ExportPlan and
 * packaging content construction.  It validates every identity/cardinality
 * relationship once, in the frozen failure-precedence order, and returns
 * nested read-only indexes.  Packaging code must consume those indexes rather
 * than search the original arrays again.
 */
import type { GroupId, SceneId, SessionId, ValidationFailure } from '../../shared/domain-model';
import type {
  ExportGroupNumberingEntry,
  ExportNumberingEntry,
  ExportPlan,
  ExportPlanOmission,
  ExportSelectedArtworkMetadata,
  ExportSelectedGroup,
  ExportSelectedOutputA,
  ExportSelectedOutputB,
  ExportSelectedProject,
  ExportSelectedSession,
  ExportSelectedValidationResult,
  ExportSelectedVersionMetadata,
} from '../../shared/contracts/export-planning';
import type { ExportSafetyLimits } from '../../shared/contracts/export-contracts';
import { registeredExportFailure } from '../failures';

type SelectedExecutionPlan = ExportPlan['selection']['executionPlans'][number];
type SelectedCover = ExportPlan['selection']['covers'][number];
type SelectedGroupPlan = ExportPlan['selection']['groupPlans'][number];

/**
 * Runtime read-only map view.  A `ReadonlyMap` type cast around `Map` would
 * still expose a working `.set()` to hostile JavaScript callers.
 */
class ReadonlyMapView<K, V> implements ReadonlyMap<K, V> {
  readonly #source: Map<K, V>;

  constructor(source: Map<K, V>) {
    this.#source = source;
    Object.freeze(this);
  }

  get size(): number {
    return this.#source.size;
  }

  get(key: K): V | undefined {
    return this.#source.get(key);
  }

  has(key: K): boolean {
    return this.#source.has(key);
  }

  entries(): MapIterator<[K, V]> {
    return this.#source.entries();
  }

  keys(): MapIterator<K> {
    return this.#source.keys();
  }

  values(): MapIterator<V> {
    return this.#source.values();
  }

  forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    for (const [key, value] of this.#source) {
      callbackfn.call(thisArg, value, key, this);
    }
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.#source[Symbol.iterator]();
  }

  get [Symbol.toStringTag](): string {
    return 'ReadonlyMap';
  }
}

function readonlyMap<K, V>(source: Map<K, V>): ReadonlyMap<K, V> {
  return new ReadonlyMapView(source);
}

function readonlyNestedMap<K1, K2, V>(
  source: Map<K1, Map<K2, V>>,
): ReadonlyMap<K1, ReadonlyMap<K2, V>> {
  const outer = new Map<K1, ReadonlyMap<K2, V>>();
  for (const [outerKey, inner] of source) outer.set(outerKey, readonlyMap(inner));
  return readonlyMap(outer);
}

function readonlyGroupedMap<K, V>(source: Map<K, V[]>): ReadonlyMap<K, readonly V[]> {
  const output = new Map<K, readonly V[]>();
  for (const [key, values] of source) output.set(key, Object.freeze([...values]));
  return readonlyMap(output);
}

function pushGrouped<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

function setNested<K1, K2, V>(
  map: Map<K1, Map<K2, V>>,
  outerKey: K1,
  innerKey: K2,
  value: V,
): boolean {
  let inner = map.get(outerKey);
  if (!inner) {
    inner = new Map<K2, V>();
    map.set(outerKey, inner);
  }
  if (inner.has(innerKey)) return false;
  inner.set(innerKey, value);
  return true;
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function failure(code: string, field: string): PackagePlanValidationResult {
  return {
    ok: false,
    failures: [registeredExportFailure(code, field)!],
  };
}

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

  /** Trusted convenience indexes used by content construction. */
  readonly sessionsById: ReadonlyMap<SessionId, ExportSelectedSession>;
  readonly executionPlansBySession: ReadonlyMap<SessionId, SelectedExecutionPlan>;
  readonly coversBySession: ReadonlyMap<SessionId, SelectedCover>;
  readonly groupPlansBySession: ReadonlyMap<SessionId, readonly SelectedGroupPlan[]>;
  readonly outputsABySession: ReadonlyMap<SessionId, readonly ExportSelectedOutputA[]>;
  readonly outputsBBySession: ReadonlyMap<SessionId, readonly ExportSelectedOutputB[]>;
  readonly numberingBySession: ReadonlyMap<SessionId, readonly ExportNumberingEntry[]>;

  /**
   * Independent Audit F2 - the complete trusted projection: every category
   * that can reach README/content/manifest is validated and snapshotted
   * here, so downstream construction never re-reads `plan.selection.*`.
   */
  readonly project: ExportSelectedProject | null;
  readonly versionsById: ReadonlyMap<string, ExportSelectedVersionMetadata>;
  readonly artworksById: ReadonlyMap<string, ExportSelectedArtworkMetadata>;
  readonly validationResultsBySession: ReadonlyMap<
    SessionId,
    readonly ExportSelectedValidationResult[]
  >;
}

export type PackagePlanValidationResult =
  | {
      readonly ok: true;
      readonly value: ValidatedPackagePlanIndex;
    }
  | {
      readonly ok: false;
      readonly failures: readonly ValidationFailure[];
    };

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

function preciseScopeFailure(plan: ExportPlan): string | null {
  if (hasDuplicates(plan.scope.sessionIds)) return 'packaging.scope.sessionIds';
  if (hasDuplicates(plan.scope.groupIds)) return 'packaging.scope.groupIds';
  if (plan.scope.sessionIds.length <= 1 && hasDuplicates(plan.scope.sceneIds)) {
    return 'packaging.scope.sceneIds';
  }
  if (hasDuplicates(plan.scope.outputAIds)) return 'packaging.scope.outputAIds';
  if (hasDuplicates(plan.scope.outputBIds)) return 'packaging.scope.outputBIds';
  if (hasDuplicates(plan.scope.coverIds)) return 'packaging.scope.coverIds';
  if (hasDuplicates(plan.scope.versionIds)) return 'packaging.scope.versionIds';
  return null;
}

interface AllowedScenes {
  readonly bySession: Map<SessionId, Set<SceneId>>;
}

function buildAllowedScenes(plan: ExportPlan): AllowedScenes | null {
  const sessionIds = plan.scope.sessionIds;
  const bySession = new Map<SessionId, Set<SceneId>>();

  if (sessionIds.length === 0) {
    return plan.scope.sceneIds.length === 0 ? { bySession } : null;
  }

  if (sessionIds.length === 1) {
    bySession.set(sessionIds[0]!, new Set(plan.scope.sceneIds));
    if (plan.scope.policy.sessionMetadata) {
      if (
        plan.selection.sessions.length !== 1 ||
        plan.selection.sessions[0]!.id !== sessionIds[0]
      ) {
        return null;
      }
    }
    return { bySession };
  }

  const selectedSessionIds = plan.selection.sessions.map((session) => session.id);
  if (!arraysEqual(selectedSessionIds, sessionIds)) return null;
  const flattenedSceneIds: SceneId[] = [];
  for (const session of plan.selection.sessions) {
    if (hasDuplicates(session.sceneIds)) return null;
    const sceneIds = new Set(session.sceneIds);
    bySession.set(session.id, sceneIds);
    flattenedSceneIds.push(...session.sceneIds);
  }
  if (!arraysEqual(flattenedSceneIds, plan.scope.sceneIds)) return null;
  return { bySession };
}

export function hasDuplicateScopeIdentifiers(plan: ExportPlan): boolean {
  return preciseScopeFailure(plan) !== null || buildAllowedScenes(plan) === null;
}

function validateNumbering(
  plan: ExportPlan,
  allowedScenes: AllowedScenes,
  limits: ExportSafetyLimits,
): {
  readonly nested: Map<SessionId, Map<SceneId, ExportNumberingEntry>>;
  readonly grouped: Map<SessionId, ExportNumberingEntry[]>;
} | null {
  if (plan.numbering.length > limits.maxZipEntries) return null;

  const outputAIds = plan.numbering.map((entry) => entry.outputAId);
  if (!arraysEqual(outputAIds, plan.scope.outputAIds)) return null;
  if (plan.scope.scopeDetail !== 'output_a') {
    const outputBIds = plan.numbering.flatMap((entry) =>
      entry.outputBId === undefined ? [] : [entry.outputBId],
    );
    if (!arraysEqual(outputBIds, plan.scope.outputBIds)) return null;
  }

  const nested = new Map<SessionId, Map<SceneId, ExportNumberingEntry>>();
  const grouped = new Map<SessionId, ExportNumberingEntry[]>();
  for (const entry of plan.numbering) {
    const sessionScenes = allowedScenes.bySession.get(entry.sessionId);
    if (!sessionScenes?.has(entry.sceneId)) return null;
    if (!setNested(nested, entry.sessionId, entry.sceneId, entry)) return null;
    if (!Number.isInteger(entry.sceneNumber) || entry.sceneNumber <= 0) return null;
    if (entry.outputALabel !== `${entry.sceneNumber}A`) return null;
    const hasB = entry.outputBId !== undefined;
    const hasBLabel = entry.outputBLabel !== undefined;
    if (hasB !== hasBLabel) return null;
    if (hasB && entry.outputBLabel !== `${entry.sceneNumber}B`) return null;
    pushGrouped(grouped, entry.sessionId, entry);
  }
  return { nested, grouped };
}

function exactFailureMatches(actual: ValidationFailure, expected: ValidationFailure): boolean {
  return (
    actual.check === expected.check &&
    actual.field === expected.field &&
    actual.code === expected.code &&
    actual.message === expected.message &&
    actual.severity === expected.severity &&
    actual.ruleId === expected.ruleId &&
    actual.priorityClass === expected.priorityClass &&
    actual.domain === expected.domain &&
    actual.originEngine === expected.originEngine
  );
}

const OUTPUT_A_OMISSION_CODES = new Set([
  'EXPORT_MISSINGA_001',
  'EXPORT_CORRUPT_001',
  'EXPORT_PROMPTVAR_001',
]);
const OUTPUT_B_OMISSION_CODES = new Set([
  'EXPORT_SCOPE_002',
  'EXPORT_MISSINGA_001',
  'EXPORT_LINK_001',
  'EXPORT_CORRUPT_001',
  'EXPORT_STALE_001',
  'EXPORT_PROMPTVAR_001',
  'EXPORT_PNG_001',
]);
const GROUP_PLAN_OMISSION_CODES = new Set([
  'EXPORT_SCOPE_002',
  'EXPORT_CORRUPT_001',
  'EXPORT_PROMPTVAR_001',
]);

function omissionField(sessionId: SessionId, sceneId: SceneId, suffix: 'outputA' | 'outputB') {
  return `source.project.sessions.${sessionId}.scenes.${sceneId}.${suffix}`;
}

function groupPlanOmissionField(sessionId: SessionId, groupId: GroupId): string {
  return `source.project.sessions.${sessionId}.groups.${groupId}.groupPromptText`;
}

function approvedOmission(
  plan: ExportPlan,
  artifactKind: ExportPlanOmission['artifactKind'],
  entityId: string,
  field: string,
  allowedCodes: ReadonlySet<string>,
): ExportPlanOmission | null {
  const matches = plan.omissions.filter(
    (omission) =>
      omission.artifactKind === artifactKind &&
      omission.entityId === entityId &&
      omission.field === field,
  );
  if (matches.length !== 1) return null;
  const omission = matches[0]!;
  if (!allowedCodes.has(omission.code)) return null;
  const expectedIssue = registeredExportFailure(omission.code, omission.field);
  if (!expectedIssue) return null;
  const matchingIssues = plan.issues.filter(
    (issue) => issue.code === omission.code && issue.field === omission.field,
  );
  if (matchingIssues.length !== 1 || !exactFailureMatches(matchingIssues[0]!, expectedIssue)) {
    return null;
  }
  return omission;
}

interface SelectedAValidation {
  readonly nested: Map<SessionId, Map<SceneId, ExportSelectedOutputA>>;
  readonly grouped: Map<SessionId, ExportSelectedOutputA[]>;
}

function validateSelectedA(
  plan: ExportPlan,
  allowedScenes: AllowedScenes,
  numbering: Map<SessionId, Map<SceneId, ExportNumberingEntry>>,
  limits: ExportSafetyLimits,
): SelectedAValidation | null {
  if (plan.selection.outputsA.length > limits.maxZipEntries) return null;
  const nested = new Map<SessionId, Map<SceneId, ExportSelectedOutputA>>();
  const grouped = new Map<SessionId, ExportSelectedOutputA[]>();
  const seenIds = new Set<string>();

  for (const output of plan.selection.outputsA) {
    if (!allowedScenes.bySession.get(output.sessionId)?.has(output.sceneId)) return null;
    const row = numbering.get(output.sessionId)?.get(output.sceneId);
    if (
      !row ||
      output.id !== row.outputAId ||
      output.sceneNumber !== row.sceneNumber ||
      output.label !== row.outputALabel ||
      !plan.scope.outputAIds.includes(output.id) ||
      seenIds.has(output.id) ||
      !setNested(nested, output.sessionId, output.sceneId, output)
    ) {
      return null;
    }
    seenIds.add(output.id);
    pushGrouped(grouped, output.sessionId, output);
  }

  if (plan.scope.policy.outputA) {
    const expectedIds: string[] = [];
    const matchedOmissions = new Set<ExportPlanOmission>();
    for (const [sessionId, sceneIds] of allowedScenes.bySession) {
      for (const sceneId of sceneIds) {
        const row = numbering.get(sessionId)?.get(sceneId);
        const selected = nested.get(sessionId)?.get(sceneId);
        const field = omissionField(sessionId, sceneId, 'outputA');
        const omission = approvedOmission(
          plan,
          'output_a',
          `${sceneId}:output_a`,
          field,
          OUTPUT_A_OMISSION_CODES,
        );
        if (selected) {
          if (!row || omission) return null;
          expectedIds.push(row.outputAId);
        } else {
          if (!omission) return null;
          matchedOmissions.add(omission);
        }
      }
    }
    if (
      !arraysEqual(
        plan.selection.outputsA.map((output) => output.id),
        expectedIds,
      )
    ) {
      return null;
    }
    const allAOmits = plan.omissions.filter((omission) => omission.artifactKind === 'output_a');
    if (allAOmits.some((omission) => !matchedOmissions.has(omission))) return null;
  }

  return { nested, grouped };
}

interface SelectedBValidation {
  readonly nested: Map<SessionId, Map<SceneId, ExportSelectedOutputB>>;
  readonly grouped: Map<SessionId, ExportSelectedOutputB[]>;
}

/**
 * Independent Audit F1: a selected Output B in a scope whose policy also
 * selects Output A must never survive a deleted or omitted selected Output A
 * for the same `(sessionId, sceneId)` identity. `validateSelectedA` already
 * proved which identities have a genuine, non-omitted selected A (`aNested`)
 * - reusing that trusted result here (never re-deriving it from raw
 * `plan.selection.outputsA`) closes the gap without duplicating the
 * omission-reconciliation logic. Scopes whose policy never selects Output A
 * at all (`output_b`, `group_b`) are unaffected: Output B legitimately has
 * no selected A counterpart there by design.
 */
function validateSelectedB(
  plan: ExportPlan,
  allowedScenes: AllowedScenes,
  numbering: Map<SessionId, Map<SceneId, ExportNumberingEntry>>,
  aNested: Map<SessionId, Map<SceneId, ExportSelectedOutputA>>,
  limits: ExportSafetyLimits,
): SelectedBValidation | null {
  if (plan.selection.outputsB.length > limits.maxZipEntries) return null;
  const nested = new Map<SessionId, Map<SceneId, ExportSelectedOutputB>>();
  const grouped = new Map<SessionId, ExportSelectedOutputB[]>();
  const seenIds = new Set<string>();
  const seenSourceAIds = new Set<string>();
  const requireSelectedA = plan.scope.policy.outputA;

  for (const output of plan.selection.outputsB) {
    if (!allowedScenes.bySession.get(output.sessionId)?.has(output.sceneId)) return null;
    const row = numbering.get(output.sessionId)?.get(output.sceneId);
    if (
      !row ||
      output.id !== row.outputBId ||
      output.sourceOutputAId !== row.outputAId ||
      output.sceneNumber !== row.sceneNumber ||
      output.label !== row.outputBLabel ||
      output.sourceOutputALabel !== row.outputALabel ||
      !plan.scope.outputBIds.includes(output.id) ||
      seenIds.has(output.id) ||
      seenSourceAIds.has(output.sourceOutputAId) ||
      !setNested(nested, output.sessionId, output.sceneId, output)
    ) {
      return null;
    }
    if (requireSelectedA) {
      const matchingA = aNested.get(output.sessionId)?.get(output.sceneId);
      if (matchingA === undefined || matchingA.id !== output.sourceOutputAId) return null;
    }
    seenIds.add(output.id);
    seenSourceAIds.add(output.sourceOutputAId);
    pushGrouped(grouped, output.sessionId, output);
  }

  if (plan.scope.policy.outputB) {
    const expectedIds: string[] = [];
    const matchedOmissions = new Set<ExportPlanOmission>();
    for (const [sessionId, sceneIds] of allowedScenes.bySession) {
      for (const sceneId of sceneIds) {
        const row = numbering.get(sessionId)?.get(sceneId);
        const selected = nested.get(sessionId)?.get(sceneId);
        const field = omissionField(sessionId, sceneId, 'outputB');
        const entityId = row?.outputBId ?? `${sceneId}:output_b`;
        const omission = approvedOmission(
          plan,
          'output_b',
          entityId,
          field,
          OUTPUT_B_OMISSION_CODES,
        );
        if (selected) {
          if (!row?.outputBId || omission) return null;
          expectedIds.push(row.outputBId);
        } else {
          if (!omission) return null;
          matchedOmissions.add(omission);
        }
      }
    }
    if (
      !arraysEqual(
        plan.selection.outputsB.map((output) => output.id),
        expectedIds,
      )
    ) {
      return null;
    }
    const allBOmits = plan.omissions.filter((omission) => omission.artifactKind === 'output_b');
    if (allBOmits.some((omission) => !matchedOmissions.has(omission))) return null;
  }

  return { nested, grouped };
}

interface GroupValidation {
  readonly groups: Map<SessionId, Map<GroupId, ExportSelectedGroup>>;
  readonly rows: Map<SessionId, Map<GroupId, readonly ExportGroupNumberingEntry[]>>;
}

function sameGroupRow(
  actual: ExportGroupNumberingEntry,
  expected: ExportGroupNumberingEntry,
): boolean {
  return (
    actual.sessionId === expected.sessionId &&
    actual.groupId === expected.groupId &&
    actual.groupNumber === expected.groupNumber &&
    actual.groupSceneNumber === expected.groupSceneNumber &&
    actual.sceneId === expected.sceneId &&
    actual.sceneNumber === expected.sceneNumber &&
    actual.outputAId === expected.outputAId &&
    actual.outputALabel === expected.outputALabel &&
    actual.outputBId === expected.outputBId &&
    actual.outputBLabel === expected.outputBLabel
  );
}

function validateGroups(
  plan: ExportPlan,
  allowedScenes: AllowedScenes,
  numbering: Map<SessionId, Map<SceneId, ExportNumberingEntry>>,
  limits: ExportSafetyLimits,
): GroupValidation | null {
  if (
    plan.selection.groups.length > limits.maxZipEntries ||
    plan.groupNumbering.length > limits.maxZipEntries
  ) {
    return null;
  }

  const groups = new Map<SessionId, Map<GroupId, ExportSelectedGroup>>();
  const seenGroupIds = new Set<string>();
  let previousScopeIndex = -1;
  for (const group of plan.selection.groups) {
    const scopeIndex = plan.scope.groupIds.indexOf(group.id);
    if (
      scopeIndex <= previousScopeIndex ||
      seenGroupIds.has(group.id) ||
      !allowedScenes.bySession.has(group.sessionId) ||
      !Number.isInteger(group.groupNumber) ||
      group.groupNumber <= 0 ||
      group.sceneIds.length === 0 ||
      hasDuplicates(group.sceneIds) ||
      group.sceneIds.some(
        (sceneId) => !allowedScenes.bySession.get(group.sessionId)?.has(sceneId),
      ) ||
      !setNested(groups, group.sessionId, group.id, group)
    ) {
      return null;
    }
    previousScopeIndex = scopeIndex;
    seenGroupIds.add(group.id);
  }

  if (plan.selection.groups.length > 0) {
    const expectedRows: ExportGroupNumberingEntry[] = [];
    for (const group of plan.selection.groups) {
      let groupSceneNumber = 0;
      for (const sceneId of group.sceneIds) {
        const row = numbering.get(group.sessionId)?.get(sceneId);
        if (!row) continue;
        groupSceneNumber += 1;
        expectedRows.push({
          sessionId: group.sessionId,
          groupId: group.id,
          groupNumber: group.groupNumber,
          groupSceneNumber,
          sceneId,
          sceneNumber: row.sceneNumber,
          outputAId: row.outputAId,
          outputALabel: `${group.groupNumber}.${groupSceneNumber}-A`,
          ...(row.outputBId === undefined
            ? {}
            : {
                outputBId: row.outputBId,
                outputBLabel: `${group.groupNumber}.${groupSceneNumber}-B`,
              }),
        } as ExportGroupNumberingEntry);
      }
    }
    if (
      plan.groupNumbering.length !== expectedRows.length ||
      plan.groupNumbering.some((row, index) => !sameGroupRow(row, expectedRows[index]!))
    ) {
      return null;
    }
  } else {
    const seenRows = new Map<SessionId, Map<GroupId, Set<SceneId>>>();
    for (const row of plan.groupNumbering) {
      const sceneRow = numbering.get(row.sessionId)?.get(row.sceneId);
      if (
        !sceneRow ||
        !plan.scope.groupIds.includes(row.groupId) ||
        row.sceneNumber !== sceneRow.sceneNumber ||
        row.outputAId !== sceneRow.outputAId ||
        row.outputBId !== sceneRow.outputBId ||
        !Number.isInteger(row.groupNumber) ||
        row.groupNumber <= 0 ||
        !Number.isInteger(row.groupSceneNumber) ||
        row.groupSceneNumber <= 0 ||
        row.outputALabel !== `${row.groupNumber}.${row.groupSceneNumber}-A` ||
        (row.outputBId === undefined) !== (row.outputBLabel === undefined) ||
        (row.outputBId !== undefined &&
          row.outputBLabel !== `${row.groupNumber}.${row.groupSceneNumber}-B`)
      ) {
        return null;
      }
      let byGroup = seenRows.get(row.sessionId);
      if (!byGroup) {
        byGroup = new Map();
        seenRows.set(row.sessionId, byGroup);
      }
      let scenes = byGroup.get(row.groupId);
      if (!scenes) {
        scenes = new Set();
        byGroup.set(row.groupId, scenes);
      }
      if (scenes.has(row.sceneId)) return null;
      scenes.add(row.sceneId);
    }
  }

  const mutableRows = new Map<SessionId, Map<GroupId, ExportGroupNumberingEntry[]>>();
  for (const row of plan.groupNumbering) {
    let byGroup = mutableRows.get(row.sessionId);
    if (!byGroup) {
      byGroup = new Map();
      mutableRows.set(row.sessionId, byGroup);
    }
    const existing = byGroup.get(row.groupId);
    if (existing) existing.push(row);
    else byGroup.set(row.groupId, [row]);
  }
  const frozenRows = new Map<SessionId, Map<GroupId, readonly ExportGroupNumberingEntry[]>>();
  for (const [sessionId, byGroup] of mutableRows) {
    const frozenByGroup = new Map<GroupId, readonly ExportGroupNumberingEntry[]>();
    for (const [groupId, rows] of byGroup) frozenByGroup.set(groupId, Object.freeze([...rows]));
    frozenRows.set(sessionId, frozenByGroup);
  }
  return { groups, rows: frozenRows };
}

/**
 * Independent Audit F3: a selected group plan must reconcile against its
 * *authoritative* selected group - the same `groupsBySessionAndId` trusted
 * index `validateGroups` already built (never a fresh scan of raw
 * `plan.selection.groups`) - not merely its own internally self-consistent
 * fields. The audit's exact reproduction forged `groupNumber` to `9` on both
 * `selection.groups[0]` and every `groupNumbering` row while leaving
 * `selection.groupPlans[0].groupNumber` at the stale authoritative value
 * `1`; requiring `groupPlanRow.groupNumber === group.groupNumber` (the real
 * selected group's own field) rather than comparing the plan only to
 * itself closes this. Also rejects a group plan for an unknown/mismatched
 * `(sessionId, groupId)`, a duplicate group-plan identity, and - when
 * `policy.groupPlans` requires one - a missing group plan without a
 * structurally valid, registered `group_plan` omission.
 */
function validateGroupPlans(
  plan: ExportPlan,
  groups: Map<SessionId, Map<GroupId, ExportSelectedGroup>>,
): Map<SessionId, SelectedGroupPlan[]> | null {
  const bySessionAndGroup = new Map<SessionId, Map<GroupId, SelectedGroupPlan>>();
  for (const groupPlanRow of plan.selection.groupPlans) {
    const group = groups.get(groupPlanRow.sessionId)?.get(groupPlanRow.groupId);
    if (
      !group ||
      groupPlanRow.groupNumber !== group.groupNumber ||
      !setNested(bySessionAndGroup, groupPlanRow.sessionId, groupPlanRow.groupId, groupPlanRow)
    ) {
      return null;
    }
  }

  if (plan.scope.policy.groupPlans) {
    const matchedOmissions = new Set<ExportPlanOmission>();
    for (const [sessionId, groupsById] of groups) {
      for (const groupId of groupsById.keys()) {
        const selected = bySessionAndGroup.get(sessionId)?.get(groupId);
        const field = groupPlanOmissionField(sessionId, groupId);
        const omission = approvedOmission(
          plan,
          'group_plan',
          groupId,
          field,
          GROUP_PLAN_OMISSION_CODES,
        );
        if (selected) {
          if (omission) return null;
        } else {
          if (!omission) return null;
          matchedOmissions.add(omission);
        }
      }
    }
    const allGroupPlanOmits = plan.omissions.filter(
      (omission) => omission.artifactKind === 'group_plan',
    );
    if (allGroupPlanOmits.some((omission) => !matchedOmissions.has(omission))) return null;
  }

  const grouped = new Map<SessionId, SelectedGroupPlan[]>();
  for (const groupPlanRow of plan.selection.groupPlans) {
    pushGrouped(grouped, groupPlanRow.sessionId, groupPlanRow);
  }
  return grouped;
}

function buildUniqueMap<K, V>(values: readonly V[], keyOf: (value: V) => K): Map<K, V> | null {
  const result = new Map<K, V>();
  for (const value of values) {
    const key = keyOf(value);
    if (result.has(key)) return null;
    result.set(key, value);
  }
  return result;
}

/**
 * Independent Audit F2 exact reproduction: `selection.project.id` forged
 * while `scope.projectId` (the resolved scope's own authoritative anchor,
 * never touched by this mutation) stays unchanged. `hasScopePolicyViolation`
 * already proves `selection.project` is non-null exactly when
 * `policy.projectMetadata` holds; this additionally anchors its identity.
 */
function validateProject(plan: ExportPlan): boolean {
  if (plan.selection.project === null) return true;
  return plan.selection.project.id === plan.scope.projectId;
}

/**
 * Every selected session must itself be a real, in-scope session (already
 * proved by `buildAllowedScenes`'s session/scene reconciliation - this does
 * not re-derive that membership) and must anchor its own `projectId` to the
 * resolved scope's project.
 */
function validateSessions(
  plan: ExportPlan,
  allowedScenes: AllowedScenes,
): Map<SessionId, ExportSelectedSession> | null {
  const bySessionId = new Map<SessionId, ExportSelectedSession>();
  for (const session of plan.selection.sessions) {
    if (
      !allowedScenes.bySession.has(session.id) ||
      session.projectId !== plan.scope.projectId ||
      bySessionId.has(session.id)
    ) {
      return null;
    }
    bySessionId.set(session.id, session);
  }
  return bySessionId;
}

/**
 * Every selected scene must belong to a real, in-scope `(sessionId, sceneId)`
 * identity, with no duplicate - and, when `policy.sceneMetadata` requires
 * scene metadata, exactly one selected scene per allowed identity (no
 * missing, no extra).
 */
function validateScenes(plan: ExportPlan, allowedScenes: AllowedScenes): boolean {
  const seen = new Map<SessionId, Set<SceneId>>();
  for (const scene of plan.selection.scenes) {
    if (!allowedScenes.bySession.get(scene.sessionId)?.has(scene.id)) return false;
    let sceneSet = seen.get(scene.sessionId);
    if (!sceneSet) {
      sceneSet = new Set<SceneId>();
      seen.set(scene.sessionId, sceneSet);
    }
    if (sceneSet.has(scene.id)) return false;
    sceneSet.add(scene.id);
  }
  if (plan.scope.policy.sceneMetadata) {
    let totalAllowed = 0;
    for (const sceneIds of allowedScenes.bySession.values()) totalAllowed += sceneIds.size;
    if (plan.selection.scenes.length !== totalAllowed) return false;
    for (const [sessionId, sceneIds] of allowedScenes.bySession) {
      for (const sceneId of sceneIds) {
        if (!seen.get(sessionId)?.has(sceneId)) return false;
      }
    }
  }
  return true;
}

/**
 * Every selected execution plan must belong to a real, in-scope session,
 * exactly one per session, and every phase item's scene/output identity and
 * label must agree with the already-validated numbering row for that exact
 * `(sessionId, sceneId)` - never merely with itself.
 */
function validateExecutionPlans(
  plan: ExportPlan,
  allowedScenes: AllowedScenes,
  numbering: Map<SessionId, Map<SceneId, ExportNumberingEntry>>,
): Map<SessionId, SelectedExecutionPlan> | null {
  const bySession = new Map<SessionId, SelectedExecutionPlan>();
  for (const executionPlan of plan.selection.executionPlans) {
    if (
      !allowedScenes.bySession.has(executionPlan.sessionId) ||
      bySession.has(executionPlan.sessionId)
    ) {
      return null;
    }
    const sessionNumbering = numbering.get(executionPlan.sessionId);
    for (const item of executionPlan.phase1) {
      const row = sessionNumbering?.get(item.sceneId);
      if (!row || row.outputAId !== item.outputAId || row.outputALabel !== item.label) {
        return null;
      }
    }
    for (const item of executionPlan.phase2) {
      const row = sessionNumbering?.get(item.sceneId);
      if (
        !row ||
        row.outputBId !== item.outputBId ||
        row.outputBLabel !== item.label ||
        row.outputAId !== item.sourceOutputAId ||
        row.outputALabel !== item.sourceOutputALabel
      ) {
        return null;
      }
    }
    bySession.set(executionPlan.sessionId, executionPlan);
  }
  return bySession;
}

/**
 * Every selected cover must be a real, in-scope id, belong to a real, in-
 * scope session (exactly one per session), and its ordered source-Output-A
 * ids/labels must each match a real numbering row for that same session -
 * never merely agree with the cover's own paired label array.
 */
function validateCovers(
  plan: ExportPlan,
  allowedScenes: AllowedScenes,
  numbering: Map<SessionId, Map<SceneId, ExportNumberingEntry>>,
): Map<SessionId, SelectedCover> | null {
  const bySession = new Map<SessionId, SelectedCover>();
  for (const cover of plan.selection.covers) {
    if (
      !allowedScenes.bySession.has(cover.sessionId) ||
      !plan.scope.coverIds.includes(cover.id) ||
      bySession.has(cover.sessionId) ||
      cover.sourceOutputAIds.length !== cover.sourceOutputALabels.length
    ) {
      return null;
    }
    const sessionNumbering = numbering.get(cover.sessionId);
    for (let index = 0; index < cover.sourceOutputAIds.length; index += 1) {
      const outputAId = cover.sourceOutputAIds[index]!;
      const label = cover.sourceOutputALabels[index]!;
      let matched = false;
      for (const row of sessionNumbering?.values() ?? []) {
        if (row.outputAId === outputAId) {
          if (row.outputALabel !== label) return null;
          matched = true;
          break;
        }
      }
      if (!matched) return null;
    }
    bySession.set(cover.sessionId, cover);
  }
  return bySession;
}

/**
 * Every selected artwork metadata record must be referenced by exactly one
 * selected Output B (via `artworkId`); no extra/unreferenced record, no
 * duplicate, and - when `policy.artworkMetadata` requires it - no missing
 * record for a selected B that needs one.
 */
function validateArtworks(
  plan: ExportPlan,
  outputsBGrouped: Map<SessionId, ExportSelectedOutputB[]>,
): boolean {
  const requiredArtworkIds = new Set<string>();
  for (const list of outputsBGrouped.values()) {
    for (const outputB of list) requiredArtworkIds.add(outputB.artworkId);
  }
  const seenArtworkIds = new Set<string>();
  for (const artwork of plan.selection.artworks) {
    if (!requiredArtworkIds.has(artwork.id) || seenArtworkIds.has(artwork.id)) return false;
    seenArtworkIds.add(artwork.id);
  }
  if (plan.scope.policy.artworkMetadata) {
    for (const id of requiredArtworkIds) {
      if (!seenArtworkIds.has(id)) return false;
    }
  }
  return true;
}

/** Every selected version must be a real, in-scope, non-duplicate version id. */
function validateVersions(plan: ExportPlan): boolean {
  const seen = new Set<string>();
  for (const version of plan.selection.versions) {
    if (!plan.scope.versionIds.includes(version.versionId) || seen.has(version.versionId)) {
      return false;
    }
    seen.add(version.versionId);
  }
  return true;
}

/** Every selected validation result must belong to a real, in-scope session and have a unique identity. */
function validateValidationResults(plan: ExportPlan, allowedScenes: AllowedScenes): boolean {
  const seen = new Set<string>();
  for (const result of plan.selection.validationResults) {
    if (!allowedScenes.bySession.has(result.sessionId) || seen.has(result.id)) return false;
    seen.add(result.id);
  }
  return true;
}

/**
 * Where a genuine anchor exists, `plan.provenance` must agree with it - the
 * primary (canonically first) resolved session's own real fingerprint, when
 * that session's full metadata was selected. Never invents a fingerprint and
 * never substitutes a version snapshot's `stateHash` here (that anchor, when
 * relevant, is `plan.provenance.sessionFingerprint` itself for the
 * `version_snapshot` scope, which packaging never reaches - EX §13).
 */
function validateProvenance(
  plan: ExportPlan,
  sessionsById: Map<SessionId, ExportSelectedSession>,
): boolean {
  const primarySessionId = plan.scope.sessionIds[0];
  if (primarySessionId === undefined) return true;
  const primarySession = sessionsById.get(primarySessionId);
  if (primarySession === undefined) return true;
  return primarySession.fingerprint.hash === plan.provenance.sessionFingerprint;
}

/**
 * Validate in the exact frozen precedence and construct the trusted indexes
 * consumed by package content assembly.
 */
export function validatePackagePlanIntegrity(
  plan: ExportPlan,
  limits: ExportSafetyLimits,
): PackagePlanValidationResult {
  if (hasScopePolicyViolation(plan)) {
    return failure('EXPORT_SCOPE_001', 'packaging.scope.policy');
  }

  const scopeField = preciseScopeFailure(plan);
  if (scopeField) return failure('EXPORT_SCOPE_001', scopeField);
  const allowedScenes = buildAllowedScenes(plan);
  if (!allowedScenes) return failure('EXPORT_SCOPE_001', 'packaging.scope.sceneIds');

  const numbering = validateNumbering(plan, allowedScenes, limits);
  if (!numbering) return failure('EXPORT_LINK_001', 'packaging.numbering');

  const groups = validateGroups(plan, allowedScenes, numbering.nested, limits);
  if (!groups) return failure('EXPORT_GROUP_001', 'packaging.groupNumbering');

  const outputsA = validateSelectedA(plan, allowedScenes, numbering.nested, limits);
  if (!outputsA) return failure('EXPORT_LINK_001', 'packaging.selection.outputsA');

  const outputsB = validateSelectedB(
    plan,
    allowedScenes,
    numbering.nested,
    outputsA.nested,
    limits,
  );
  if (!outputsB) return failure('EXPORT_LINK_001', 'packaging.selection.outputsB');

  const groupPlans = validateGroupPlans(plan, groups.groups);
  if (!groupPlans) return failure('EXPORT_GROUP_001', 'packaging.groupNumbering');

  if (!validateProject(plan)) return failure('EXPORT_SCOPE_001', 'packaging.selection.project');

  const sessions = validateSessions(plan, allowedScenes);
  if (!sessions) return failure('EXPORT_LINK_001', 'packaging.selection.sessions');

  if (!validateScenes(plan, allowedScenes)) {
    return failure('EXPORT_LINK_001', 'packaging.selection.scenes');
  }

  const executionPlans = validateExecutionPlans(plan, allowedScenes, numbering.nested);
  if (!executionPlans) return failure('EXPORT_LINK_001', 'packaging.selection.executionPlans');

  const covers = validateCovers(plan, allowedScenes, numbering.nested);
  if (!covers) return failure('EXPORT_LINK_001', 'packaging.selection.covers');

  if (!validateArtworks(plan, outputsB.grouped)) {
    return failure('EXPORT_LINK_001', 'packaging.selection.artworks');
  }

  if (!validateVersions(plan)) return failure('EXPORT_SCOPE_001', 'packaging.selection.versions');

  if (!validateValidationResults(plan, allowedScenes)) {
    return failure('EXPORT_LINK_001', 'packaging.selection.validationResults');
  }

  if (!validateProvenance(plan, sessions)) {
    return failure('EXPORT_LINK_001', 'packaging.provenance');
  }

  const versionsById = buildUniqueMap(plan.selection.versions, (version) => version.versionId)!;
  const artworksById = buildUniqueMap(plan.selection.artworks, (artwork) => artwork.id)!;
  const validationResultsGrouped = new Map<SessionId, ExportSelectedValidationResult[]>();
  for (const result of plan.selection.validationResults) {
    pushGrouped(validationResultsGrouped, result.sessionId, result);
  }

  return {
    ok: true,
    value: Object.freeze({
      numberingBySessionAndScene: readonlyNestedMap(numbering.nested),
      outputABySessionAndScene: readonlyNestedMap(outputsA.nested),
      outputBBySessionAndScene: readonlyNestedMap(outputsB.nested),
      groupsBySessionAndId: readonlyNestedMap(groups.groups),
      groupNumberingBySessionAndGroup: readonlyNestedMap(groups.rows),
      sessionsById: readonlyMap(sessions),
      executionPlansBySession: readonlyMap(executionPlans),
      coversBySession: readonlyMap(covers),
      groupPlansBySession: readonlyGroupedMap(groupPlans),
      outputsABySession: readonlyGroupedMap(outputsA.grouped),
      outputsBBySession: readonlyGroupedMap(outputsB.grouped),
      numberingBySession: readonlyGroupedMap(numbering.grouped),
      project: plan.selection.project,
      versionsById: readonlyMap(versionsById),
      artworksById: readonlyMap(artworksById),
      validationResultsBySession: readonlyGroupedMap(validationResultsGrouped),
    }),
  };
}
