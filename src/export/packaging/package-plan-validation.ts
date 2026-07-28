/**
 * Semantic package-plan validation and trusted lookup construction.
 *
 * This module is the sole boundary between the shape-valid ExportPlan and
 * packaging content construction.  It validates every identity/cardinality
 * relationship once, in the frozen failure-precedence order, and returns
 * nested read-only indexes.  Packaging code must consume those indexes rather
 * than search the original arrays again.
 */
import {
  ExportScope,
  OutputStatus,
  type GroupId,
  type SceneId,
  type SessionId,
  type ValidationFailure,
} from '../../shared/domain-model';
import type {
  ExportGroupNumberingEntry,
  ExportNumberingEntry,
  ExportPlan,
  ExportPlanOmission,
  ExportResolvedScope,
  ExportScopeContentPolicy,
  ExportSelectedGroup,
  ExportSelectedOutputA,
  ExportSelectedOutputB,
  ExportSelectedSession,
} from '../../shared/contracts/export-planning';
import type { ExportSafetyLimits } from '../../shared/contracts/export-contracts';
import { registeredExportFailure } from '../failures';
import { compareUtf8 } from '../runtime';

type SelectedExecutionPlan = ExportPlan['selection']['executionPlans'][number];
type SelectedCover = ExportPlan['selection']['covers'][number];
type SelectedGroupPlan = ExportPlan['selection']['groupPlans'][number];
type SelectedScene = ExportPlan['selection']['scenes'][number];
type SelectedArtwork = ExportPlan['selection']['artworks'][number];
type SelectedProduct = ExportPlan['selection']['products'][number];
type SelectedSeason = ExportPlan['selection']['seasons'][number];
type SelectedColor = ExportPlan['selection']['colors'][number];
type SelectedValidationResult = ExportPlan['selection']['validationResults'][number];
type SelectedVersion = ExportPlan['selection']['versions'][number];

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

/**
 * Descriptor-only deep snapshot. It never reads through a property accessor
 * and never calls `toJSON`, a constructor, or user code. The formatter shape
 * gate has already constrained the value to JSON-like data; this second
 * boundary gives packaging detached, deeply frozen ownership and also keeps
 * direct callers fail-closed.
 */
function snapshotTrustedValue<T>(value: T, active = new WeakSet<object>()): T {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value !== 'object' || active.has(value)) throw new Error('unsafe-plan-value');

  const source = value as object;
  const array = Array.isArray(source);
  const prototype = Object.getPrototypeOf(source);
  if (
    array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null
  ) {
    throw new Error('unsafe-plan-prototype');
  }
  if (Object.getOwnPropertySymbols(source).length > 0) throw new Error('unsafe-plan-symbol');

  active.add(source);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(source);
    const names = Object.getOwnPropertyNames(source);
    if (array) {
      const length = descriptors.length;
      if (
        !length ||
        !('value' in length) ||
        !Number.isSafeInteger(length.value) ||
        length.value < 0 ||
        names.length !== length.value + 1
      ) {
        throw new Error('unsafe-plan-array');
      }
      const output: unknown[] = [];
      for (let index = 0; index < length.value; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
          throw new Error('unsafe-plan-array-entry');
        }
        output.push(snapshotTrustedValue(descriptor.value, active));
      }
      return Object.freeze(output) as T;
    }

    const output = Object.create(prototype === null ? null : Object.prototype) as Record<
      string,
      unknown
    >;
    for (const name of names) {
      const descriptor = descriptors[name];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        throw new Error('unsafe-plan-property');
      }
      Object.defineProperty(output, name, {
        value: snapshotTrustedValue(descriptor.value, active),
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(output) as T;
  } finally {
    active.delete(source);
  }
}

function snapshotTrustedPlan(plan: ExportPlan): ExportPlan {
  return snapshotTrustedValue(plan);
}

function failure(code: string, field: string): PackagePlanValidationResult {
  return {
    ok: false,
    failures: [registeredExportFailure(code, field)!],
  };
}

export interface ValidatedPackagePlanIndex {
  /** Detached, deeply frozen, descriptor-safe source for every downstream byte. */
  readonly plan: ExportPlan;
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
  readonly scenesBySessionAndId: ReadonlyMap<SessionId, ReadonlyMap<SceneId, SelectedScene>>;
  readonly executionPlansBySession: ReadonlyMap<SessionId, SelectedExecutionPlan>;
  readonly coversBySession: ReadonlyMap<SessionId, SelectedCover>;
  readonly groupPlansBySession: ReadonlyMap<SessionId, readonly SelectedGroupPlan[]>;
  readonly artworksById: ReadonlyMap<string, SelectedArtwork>;
  readonly productsById: ReadonlyMap<string, SelectedProduct>;
  readonly seasonsById: ReadonlyMap<string, SelectedSeason>;
  readonly colorsById: ReadonlyMap<string, SelectedColor>;
  readonly validationResultsBySessionAndId: ReadonlyMap<
    SessionId,
    ReadonlyMap<string, SelectedValidationResult>
  >;
  readonly versionsById: ReadonlyMap<string, SelectedVersion>;
  readonly outputsABySession: ReadonlyMap<SessionId, readonly ExportSelectedOutputA[]>;
  readonly outputsBBySession: ReadonlyMap<SessionId, readonly ExportSelectedOutputB[]>;
  readonly numberingBySession: ReadonlyMap<SessionId, readonly ExportNumberingEntry[]>;
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

const POLICY_KEYS = [
  'projectMetadata',
  'sessionMetadata',
  'sceneMetadata',
  'outputA',
  'outputB',
  'groupMetadata',
  'groupPlans',
  'executionPlans',
  'cover',
  'artworkMetadata',
  'validationResults',
  'versionMetadata',
  'backupResolutionOnly',
] as const satisfies readonly (keyof ExportScopeContentPolicy)[];

const SCOPE_ARRAY_FIELDS = [
  'sessionIds',
  'groupIds',
  'sceneIds',
  'outputAIds',
  'outputBIds',
  'coverIds',
  'versionIds',
] as const satisfies readonly (keyof Pick<
  ExportResolvedScope,
  'sessionIds' | 'groupIds' | 'sceneIds' | 'outputAIds' | 'outputBIds' | 'coverIds' | 'versionIds'
>)[];

type ScopeArrayField = (typeof SCOPE_ARRAY_FIELDS)[number];

const scopeFields = (...fields: readonly ScopeArrayField[]): ReadonlySet<ScopeArrayField> =>
  new Set(fields);

/**
 * Closed-world resolved-scope field matrix. A field may exist as the contract's
 * required empty array, but only the fields listed for a scope kind may carry
 * identities. The order of SCOPE_ARRAY_FIELDS freezes failure precedence.
 */
const ALLOWED_SCOPE_FIELDS: Readonly<
  Record<ExportResolvedScope['scopeDetail'], ReadonlySet<ScopeArrayField>>
> = Object.freeze({
  output_a: scopeFields('sessionIds', 'sceneIds', 'outputAIds'),
  output_b: scopeFields('sessionIds', 'sceneIds', 'outputAIds', 'outputBIds'),
  pair: scopeFields('sessionIds', 'sceneIds', 'outputAIds', 'outputBIds'),
  group_a: scopeFields('sessionIds', 'groupIds', 'sceneIds', 'outputAIds'),
  group_b: scopeFields('sessionIds', 'groupIds', 'sceneIds', 'outputAIds', 'outputBIds'),
  group: scopeFields('sessionIds', 'groupIds', 'sceneIds', 'outputAIds', 'outputBIds'),
  cover: scopeFields('sessionIds', 'sceneIds', 'outputAIds', 'coverIds'),
  execution_plan: scopeFields('sessionIds', 'sceneIds', 'outputAIds', 'outputBIds'),
  session: scopeFields(
    'sessionIds',
    'groupIds',
    'sceneIds',
    'outputAIds',
    'outputBIds',
    'coverIds',
  ),
  complete_project: scopeFields(
    'sessionIds',
    'groupIds',
    'sceneIds',
    'outputAIds',
    'outputBIds',
    'coverIds',
  ),
  all: scopeFields('sessionIds', 'groupIds', 'sceneIds', 'outputAIds', 'outputBIds', 'coverIds'),
  version_snapshot: scopeFields('versionIds'),
  backup: scopeFields(
    'sessionIds',
    'groupIds',
    'sceneIds',
    'outputAIds',
    'outputBIds',
    'coverIds',
    'versionIds',
  ),
  prompt_pack: scopeFields(
    'sessionIds',
    'groupIds',
    'sceneIds',
    'outputAIds',
    'outputBIds',
    'coverIds',
  ),
});

/** Returns the first exact illegal non-empty resolved-scope field, if any. */
export function preciseScopeKindFieldFailure(plan: ExportPlan): string | null {
  const allowedFields = ALLOWED_SCOPE_FIELDS[plan.scope.scopeDetail];
  if (allowedFields === undefined) return 'packaging.scope.scopeDetail';
  for (const field of SCOPE_ARRAY_FIELDS) {
    const value = plan.scope[field];
    if (!Array.isArray(value)) return `packaging.scope.${field}`;
    if (!allowedFields.has(field) && value.length > 0) return `packaging.scope.${field}`;
  }
  return null;
}

function expectedScopePolicy(plan: ExportPlan): ExportScopeContentPolicy | null {
  const enabled = (values: Partial<ExportScopeContentPolicy>): ExportScopeContentPolicy => ({
    projectMetadata: false,
    sessionMetadata: false,
    sceneMetadata: false,
    outputA: false,
    outputB: false,
    groupMetadata: false,
    groupPlans: false,
    executionPlans: false,
    cover: false,
    artworkMetadata: false,
    validationResults: false,
    versionMetadata: false,
    backupResolutionOnly: false,
    ...values,
  });

  switch (plan.scope.scopeDetail) {
    case 'output_a':
      return plan.scope.baseScope === ExportScope.Output ? enabled({ outputA: true }) : null;
    case 'output_b':
      return plan.scope.baseScope === ExportScope.Output
        ? enabled({ outputB: true, artworkMetadata: true })
        : null;
    case 'pair':
      return plan.scope.baseScope === ExportScope.Output
        ? enabled({ outputA: true, outputB: true, artworkMetadata: true })
        : null;
    case 'group_a':
      return plan.scope.baseScope === ExportScope.Group
        ? enabled({ outputA: true, groupMetadata: true })
        : null;
    case 'group_b':
      return plan.scope.baseScope === ExportScope.Group
        ? enabled({ outputB: true, groupMetadata: true, artworkMetadata: true })
        : null;
    case 'group':
      return plan.scope.baseScope === ExportScope.Group
        ? enabled({
            outputA: true,
            outputB: true,
            groupMetadata: true,
            groupPlans: true,
            artworkMetadata: true,
          })
        : null;
    case 'cover':
      return plan.scope.baseScope === ExportScope.Cover ? enabled({ cover: true }) : null;
    case 'execution_plan':
      return plan.scope.baseScope === ExportScope.Session
        ? enabled({ executionPlans: true })
        : null;
    case 'session':
      return plan.scope.baseScope === ExportScope.Session
        ? enabled({
            sessionMetadata: true,
            sceneMetadata: true,
            outputA: true,
            outputB: true,
            groupMetadata: true,
            groupPlans: true,
            executionPlans: true,
            cover: true,
            artworkMetadata: true,
            validationResults: true,
          })
        : null;
    case 'complete_project':
    case 'all':
      return plan.scope.baseScope === ExportScope.All
        ? enabled({
            projectMetadata: true,
            sessionMetadata: true,
            sceneMetadata: true,
            outputA: true,
            outputB: true,
            groupMetadata: true,
            groupPlans: true,
            executionPlans: true,
            cover: true,
            artworkMetadata: true,
            validationResults: true,
          })
        : null;
    case 'version_snapshot':
      return plan.scope.baseScope === ExportScope.All
        ? enabled({ versionMetadata: true, backupResolutionOnly: true })
        : null;
    case 'backup':
      return plan.scope.baseScope === ExportScope.All
        ? enabled({
            projectMetadata: true,
            sessionMetadata: true,
            sceneMetadata: true,
            groupMetadata: true,
            versionMetadata: plan.scope.versionIds.length > 0,
            backupResolutionOnly: true,
          })
        : null;
    case 'prompt_pack':
      return plan.scope.baseScope === ExportScope.All ||
        plan.scope.baseScope === ExportScope.Session
        ? enabled({
            projectMetadata: plan.scope.baseScope === ExportScope.All,
            sessionMetadata: true,
            outputA: true,
            outputB: true,
            groupMetadata: true,
            groupPlans: true,
            executionPlans: true,
            cover: true,
            artworkMetadata: true,
          })
        : null;
  }
}

export function hasScopePolicyViolation(plan: ExportPlan): boolean {
  const expected = expectedScopePolicy(plan);
  if (expected === null || POLICY_KEYS.some((key) => plan.scope.policy[key] !== expected[key])) {
    return true;
  }
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

function validateProject(plan: ExportPlan): boolean {
  const project = plan.selection.project;
  if (!plan.scope.policy.projectMetadata) return project === null;
  if (project === null || project.id !== plan.scope.projectId) return false;
  if (
    hasDuplicates(project.sessionIds) ||
    hasDuplicates(project.versionIds) ||
    !arraysEqual(project.sessionIds, plan.scope.sessionIds)
  ) {
    return false;
  }
  if (project.currentVersionId !== null && !project.versionIds.includes(project.currentVersionId)) {
    return false;
  }
  return true;
}

interface SessionValidation {
  readonly allowedScenes: AllowedScenes;
  readonly sessions: Map<SessionId, ExportSelectedSession>;
}

function validateSessionsAndAllowedScenes(plan: ExportPlan): SessionValidation | null {
  const sessions = new Map<SessionId, ExportSelectedSession>();
  const bySession = new Map<SessionId, Set<SceneId>>();

  if (!plan.scope.policy.sessionMetadata) {
    if (plan.selection.sessions.length !== 0) return null;
    if (plan.scope.sessionIds.length === 0) {
      return plan.scope.sceneIds.length === 0 ? { allowedScenes: { bySession }, sessions } : null;
    }
    // Every supported scope without session metadata is single-session.
    if (plan.scope.sessionIds.length !== 1 || hasDuplicates(plan.scope.sceneIds)) return null;
    bySession.set(plan.scope.sessionIds[0]!, new Set(plan.scope.sceneIds));
    return { allowedScenes: { bySession }, sessions };
  }

  if (plan.selection.sessions.length !== plan.scope.sessionIds.length) return null;
  const flattenedSceneIds: SceneId[] = [];
  for (let index = 0; index < plan.selection.sessions.length; index += 1) {
    const session = plan.selection.sessions[index]!;
    const expectedSessionId = plan.scope.sessionIds[index];
    if (
      session.id !== expectedSessionId ||
      session.projectId !== plan.scope.projectId ||
      sessions.has(session.id) ||
      hasDuplicates(session.sceneIds)
    ) {
      return null;
    }
    sessions.set(session.id, session);
    bySession.set(session.id, new Set(session.sceneIds));
    flattenedSceneIds.push(...session.sceneIds);
  }
  if (!arraysEqual(flattenedSceneIds, plan.scope.sceneIds)) return null;
  return { allowedScenes: { bySession }, sessions };
}

function validateScenes(
  plan: ExportPlan,
  allowedScenes: AllowedScenes,
): Map<SessionId, Map<SceneId, SelectedScene>> | null {
  const nested = new Map<SessionId, Map<SceneId, SelectedScene>>();
  if (!plan.scope.policy.sceneMetadata) {
    return plan.selection.scenes.length === 0 ? nested : null;
  }

  const expected: readonly (readonly [SessionId, SceneId])[] = [
    ...allowedScenes.bySession.entries(),
  ].flatMap(([sessionId, sceneIds]) =>
    [...sceneIds].map((sceneId) => [sessionId, sceneId] as const),
  );
  if (plan.selection.scenes.length !== expected.length) return null;
  for (let index = 0; index < expected.length; index += 1) {
    const scene = plan.selection.scenes[index]!;
    const [expectedSessionId, expectedSceneId] = expected[index]!;
    if (
      scene.sessionId !== expectedSessionId ||
      scene.id !== expectedSceneId ||
      !setNested(nested, scene.sessionId, scene.id, scene)
    ) {
      return null;
    }
  }
  return nested;
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
  const expectedIdentities = [...allowedScenes.bySession.entries()].flatMap(
    ([sessionId, sceneIds]) => [...sceneIds].map((sceneId) => [sessionId, sceneId] as const),
  );
  if (
    plan.numbering.length !== expectedIdentities.length ||
    plan.numbering.some(
      (entry, index) =>
        entry.sessionId !== expectedIdentities[index]![0] ||
        entry.sceneId !== expectedIdentities[index]![1],
    )
  ) {
    return null;
  }

  const outputAIds = plan.numbering.map((entry) => entry.outputAId);
  if (!arraysEqual(outputAIds, plan.scope.outputAIds)) return null;
  if (ALLOWED_SCOPE_FIELDS[plan.scope.scopeDetail].has('outputBIds')) {
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

function omissionField(sessionId: SessionId, sceneId: SceneId, suffix: 'outputA' | 'outputB') {
  return `source.project.sessions.${sessionId}.scenes.${sceneId}.${suffix}`;
}

function approvedOmission(
  plan: ExportPlan,
  artifactKind: 'output_a' | 'output_b',
  entityId: string,
  field: string,
): ExportPlanOmission | null {
  const matches = plan.omissions.filter(
    (omission) =>
      omission.artifactKind === artifactKind &&
      omission.entityId === entityId &&
      omission.field === field,
  );
  if (matches.length !== 1) return null;
  const omission = matches[0]!;
  const allowedCodes =
    artifactKind === 'output_a' ? OUTPUT_A_OMISSION_CODES : OUTPUT_B_OMISSION_CODES;
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

function hasApprovedGeneralOmission(
  plan: ExportPlan,
  artifactKind: ExportPlanOmission['artifactKind'],
  entityId: string,
  allowedFields?: string | readonly string[],
): boolean {
  const fields =
    allowedFields === undefined
      ? null
      : new Set(typeof allowedFields === 'string' ? [allowedFields] : allowedFields);
  const matches = plan.omissions.filter(
    (omission) =>
      omission.artifactKind === artifactKind &&
      omission.entityId === entityId &&
      (fields === null || fields.has(omission.field)),
  );
  if (matches.length !== 1) return false;
  const omission = matches[0]!;
  const expectedIssue = registeredExportFailure(omission.code, omission.field);
  if (!expectedIssue) return false;
  const issues = plan.issues.filter(
    (issue) => issue.code === omission.code && issue.field === omission.field,
  );
  return issues.length === 1 && exactFailureMatches(issues[0]!, expectedIssue);
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
        const omission = approvedOmission(plan, 'output_a', `${sceneId}:output_a`, field);
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
 * Approved Programmer-2 idea, re-applied inside Programmer-1's wider index:
 * in every policy that emits A and B together, a selected B cannot survive
 * unless the matching selected A is present at the same nested identity.
 * This pre-check intentionally precedes A omission/cardinality validation so
 * the frozen dependency failure is always attributed to outputsB.
 */
function hasMissingSelectedADependency(plan: ExportPlan): boolean {
  if (!plan.scope.policy.outputA || !plan.scope.policy.outputB) return false;
  const selectedA = new Map<SessionId, Map<SceneId, ExportSelectedOutputA[]>>();
  for (const outputA of plan.selection.outputsA) {
    let byScene = selectedA.get(outputA.sessionId);
    if (!byScene) {
      byScene = new Map();
      selectedA.set(outputA.sessionId, byScene);
    }
    const values = byScene.get(outputA.sceneId);
    if (values) values.push(outputA);
    else byScene.set(outputA.sceneId, [outputA]);
  }
  return plan.selection.outputsB.some((outputB) => {
    const candidates = selectedA.get(outputB.sessionId)?.get(outputB.sceneId) ?? [];
    return !candidates.some((outputA) => outputA.id === outputB.sourceOutputAId);
  });
}

function validateSelectedB(
  plan: ExportPlan,
  allowedScenes: AllowedScenes,
  numbering: Map<SessionId, Map<SceneId, ExportNumberingEntry>>,
  selectedA: Map<SessionId, Map<SceneId, ExportSelectedOutputA>>,
  limits: ExportSafetyLimits,
): SelectedBValidation | null {
  if (plan.selection.outputsB.length > limits.maxZipEntries) return null;
  const nested = new Map<SessionId, Map<SceneId, ExportSelectedOutputB>>();
  const grouped = new Map<SessionId, ExportSelectedOutputB[]>();
  const seenIds = new Set<string>();
  const seenSourceAIds = new Set<string>();

  for (const output of plan.selection.outputsB) {
    if (!allowedScenes.bySession.get(output.sessionId)?.has(output.sceneId)) return null;
    const row = numbering.get(output.sessionId)?.get(output.sceneId);
    const pairedA = selectedA.get(output.sessionId)?.get(output.sceneId);
    if (
      !row ||
      output.id !== row.outputBId ||
      output.sourceOutputAId !== row.outputAId ||
      output.sceneNumber !== row.sceneNumber ||
      output.label !== row.outputBLabel ||
      output.sourceOutputALabel !== row.outputALabel ||
      !plan.scope.outputBIds.includes(output.id) ||
      (plan.scope.policy.outputA &&
        (pairedA === undefined || pairedA.id !== output.sourceOutputAId)) ||
      seenIds.has(output.id) ||
      seenSourceAIds.has(output.sourceOutputAId) ||
      !setNested(nested, output.sessionId, output.sceneId, output)
    ) {
      return null;
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
        const omission = approvedOmission(plan, 'output_b', entityId, field);
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

  const groupFields = (groupId: GroupId, suffix: 'sceneIds' | 'groupPromptText'): string[] =>
    plan.scope.sessionIds.map(
      (sessionId) => `source.project.sessions.${sessionId}.groups.${groupId}.${suffix}`,
    );
  const groupOmissions = plan.omissions.filter((omission) => omission.artifactKind === 'group');
  if (
    (!plan.scope.policy.groupMetadata && groupOmissions.length > 0) ||
    groupOmissions.some(
      (omission) =>
        !plan.scope.groupIds.includes(omission.entityId as GroupId) ||
        !hasApprovedGeneralOmission(
          plan,
          'group',
          omission.entityId,
          groupFields(omission.entityId as GroupId, 'sceneIds'),
        ),
    )
  ) {
    return null;
  }
  const expectedGroupIds = plan.scope.groupIds.filter(
    (groupId) =>
      !hasApprovedGeneralOmission(plan, 'group', groupId, groupFields(groupId, 'sceneIds')),
  );
  if (
    plan.scope.policy.groupMetadata &&
    !arraysEqual(
      plan.selection.groups.map((group) => group.id),
      expectedGroupIds,
    )
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
    const observedGroupIds: GroupId[] = [];
    const groupNumbers = new Map<GroupId, number>();
    for (const row of plan.groupNumbering) {
      const sceneRow = numbering.get(row.sessionId)?.get(row.sceneId);
      if (!observedGroupIds.includes(row.groupId)) observedGroupIds.push(row.groupId);
      const expectedGroupNumber = groupNumbers.get(row.groupId);
      if (
        !sceneRow ||
        !expectedGroupIds.includes(row.groupId) ||
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
          row.outputBLabel !== `${row.groupNumber}.${row.groupSceneNumber}-B`) ||
        (expectedGroupNumber !== undefined && expectedGroupNumber !== row.groupNumber)
      ) {
        return null;
      }
      if (expectedGroupNumber === undefined) groupNumbers.set(row.groupId, row.groupNumber);
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
      if (scenes.has(row.sceneId) || row.groupSceneNumber !== scenes.size + 1) return null;
      scenes.add(row.sceneId);
    }
    if (!arraysEqual(observedGroupIds, expectedGroupIds)) return null;
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

  if (plan.scope.policy.groupPlans) {
    const groupPlanOmissions = plan.omissions.filter(
      (omission) => omission.artifactKind === 'group_plan',
    );
    if (
      groupPlanOmissions.some(
        (omission) =>
          !plan.scope.groupIds.includes(omission.entityId as GroupId) ||
          !hasApprovedGeneralOmission(
            plan,
            'group_plan',
            omission.entityId,
            groupFields(omission.entityId as GroupId, 'groupPromptText'),
          ),
      )
    ) {
      return null;
    }
    const expectedGroups = plan.selection.groups.filter(
      (group) =>
        !hasApprovedGeneralOmission(
          plan,
          'group_plan',
          group.id,
          groupFields(group.id, 'groupPromptText'),
        ),
    );
    if (plan.selection.groupPlans.length !== expectedGroups.length) return null;
    for (let index = 0; index < expectedGroups.length; index += 1) {
      const group = expectedGroups[index]!;
      const groupPlan = plan.selection.groupPlans[index]!;
      if (
        groupPlan.groupId !== group.id ||
        groupPlan.sessionId !== group.sessionId ||
        groupPlan.groupNumber !== group.groupNumber
      ) {
        return null;
      }
    }
  } else if (
    plan.selection.groupPlans.length !== 0 ||
    plan.omissions.some((omission) => omission.artifactKind === 'group_plan')
  ) {
    return null;
  }

  return { groups, rows: frozenRows };
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

function validateExecutionPlans(
  plan: ExportPlan,
  numbering: Map<SessionId, ExportNumberingEntry[]>,
): Map<SessionId, SelectedExecutionPlan> | null {
  if (!plan.scope.policy.executionPlans) {
    return plan.selection.executionPlans.length === 0 &&
      !plan.omissions.some((omission) => omission.artifactKind === 'execution_plan')
      ? new Map()
      : null;
  }

  const expected: {
    readonly sessionId: SessionId;
    readonly phase1: readonly {
      readonly sceneId: SceneId;
      readonly outputAId: string;
      readonly label: string;
    }[];
    readonly phase2: readonly {
      readonly sceneId: SceneId;
      readonly outputBId: string;
      readonly label: string;
      readonly sourceOutputAId: string;
      readonly sourceOutputALabel: string;
    }[];
  }[] = [];
  for (const sessionId of plan.scope.sessionIds) {
    const rows = numbering.get(sessionId) ?? [];
    const phase1 = rows
      .filter(
        (row) =>
          approvedOmission(
            plan,
            'output_a',
            `${row.sceneId}:output_a`,
            omissionField(sessionId, row.sceneId, 'outputA'),
          ) === null,
      )
      .map((row) => ({
        sceneId: row.sceneId,
        outputAId: row.outputAId,
        label: row.outputALabel,
      }));
    const phase2 = rows
      .filter(
        (row) =>
          row.outputBId !== undefined &&
          approvedOmission(
            plan,
            'output_b',
            row.outputBId,
            omissionField(sessionId, row.sceneId, 'outputB'),
          ) === null,
      )
      .map((row) => ({
        sceneId: row.sceneId,
        outputBId: row.outputBId!,
        label: row.outputBLabel!,
        sourceOutputAId: row.outputAId,
        sourceOutputALabel: row.outputALabel,
      }));
    const executionOmitted = hasApprovedGeneralOmission(
      plan,
      'execution_plan',
      sessionId,
      `source.project.sessions.${sessionId}.sceneOrder`,
    );
    if (phase1.length === 0) {
      if (!executionOmitted) return null;
    } else {
      if (executionOmitted) return null;
      expected.push({ sessionId, phase1, phase2 });
    }
  }
  const executionOmissions = plan.omissions.filter(
    (omission) => omission.artifactKind === 'execution_plan',
  );
  if (
    executionOmissions.some(
      (omission) =>
        !plan.scope.sessionIds.includes(omission.entityId as SessionId) ||
        !hasApprovedGeneralOmission(
          plan,
          'execution_plan',
          omission.entityId,
          `source.project.sessions.${omission.entityId}.sceneOrder`,
        ),
    )
  ) {
    return null;
  }

  if (plan.selection.executionPlans.length !== expected.length) return null;
  const result = new Map<SessionId, SelectedExecutionPlan>();
  for (let index = 0; index < expected.length; index += 1) {
    const actual = plan.selection.executionPlans[index]!;
    const wanted = expected[index]!;
    if (
      actual.sessionId !== wanted.sessionId ||
      actual.phase1.length !== wanted.phase1.length ||
      actual.phase2.length !== wanted.phase2.length ||
      actual.phase1.some((entry, entryIndex) => {
        const target = wanted.phase1[entryIndex]!;
        return (
          entry.sceneId !== target.sceneId ||
          entry.outputAId !== target.outputAId ||
          entry.label !== target.label
        );
      }) ||
      actual.phase2.some((entry, entryIndex) => {
        const target = wanted.phase2[entryIndex]!;
        return (
          entry.sceneId !== target.sceneId ||
          entry.outputBId !== target.outputBId ||
          entry.label !== target.label ||
          entry.sourceOutputAId !== target.sourceOutputAId ||
          entry.sourceOutputALabel !== target.sourceOutputALabel
        );
      }) ||
      result.has(actual.sessionId)
    ) {
      return null;
    }
    result.set(actual.sessionId, actual);
  }
  return result;
}

interface CoverValidationSuccess {
  readonly ok: true;
  readonly covers: Map<SessionId, SelectedCover>;
  readonly canonicalCovers: readonly SelectedCover[];
}

interface CoverValidationFailure {
  readonly ok: false;
  readonly code: 'EXPORT_COVER_001' | 'EXPORT_COVERCOUNT_001';
  readonly field: string;
}

type CoverValidation = CoverValidationSuccess | CoverValidationFailure;

function coverFailure(code: CoverValidationFailure['code'], field: string): CoverValidationFailure {
  return { ok: false, code, field };
}

function canonicalCover(
  cover: SelectedCover,
  sourceOutputAIds: SelectedCover['sourceOutputAIds'],
  sourceOutputALabels: SelectedCover['sourceOutputALabels'],
): SelectedCover {
  return Object.freeze({
    id: cover.id,
    sessionId: cover.sessionId,
    sourceOutputAIds: Object.freeze([...sourceOutputAIds]),
    sourceOutputALabels: Object.freeze([...sourceOutputALabels]),
    layout: cover.layout,
    metadata: cover.metadata,
    status: cover.status,
    promptText: cover.promptText,
    generatedAt: cover.generatedAt,
    promptHash: cover.promptHash,
    renderHash: cover.renderHash,
    coverHash: cover.coverHash,
    promptMeta: cover.promptMeta,
  });
}

function validateCovers(
  plan: ExportPlan,
  numbering: Map<SessionId, ExportNumberingEntry[]>,
): CoverValidation {
  if (!plan.scope.policy.cover) {
    if (
      plan.selection.covers.length !== 0 ||
      plan.omissions.some((omission) => omission.artifactKind === 'cover')
    ) {
      return coverFailure('EXPORT_COVER_001', 'packaging.selection.covers');
    }
    return { ok: true, covers: new Map(), canonicalCovers: Object.freeze([]) };
  }

  const result = new Map<SessionId, SelectedCover>();
  const canonicalCovers: SelectedCover[] = [];
  for (let coverIndex = 0; coverIndex < plan.selection.covers.length; coverIndex += 1) {
    const cover = plan.selection.covers[coverIndex]!;
    const field = `packaging.selection.covers.${coverIndex}`;
    if (!plan.scope.sessionIds.includes(cover.sessionId) || result.has(cover.sessionId)) {
      return coverFailure('EXPORT_COVER_001', field);
    }

    const rows = numbering.get(cover.sessionId) ?? [];
    let normalizedCover = cover;
    if (cover.status === OutputStatus.Generated) {
      if (cover.generatedAt === null) {
        return coverFailure('EXPORT_COVER_001', `${field}.generatedAt`);
      }
      if (cover.sourceOutputAIds.length === 0) {
        return coverFailure('EXPORT_COVERCOUNT_001', `${field}.sourceOutputAIds`);
      }
      if (cover.sourceOutputAIds.length !== cover.sourceOutputALabels.length) {
        return coverFailure('EXPORT_COVERCOUNT_001', `${field}.sourceOutputALabels`);
      }
      if (cover.metadata.mockupCount !== cover.sourceOutputAIds.length) {
        return coverFailure('EXPORT_COVERCOUNT_001', `${field}.metadata.mockupCount`);
      }
      if (hasDuplicates(cover.sourceOutputAIds)) {
        return coverFailure('EXPORT_COVER_001', `${field}.sourceOutputAIds`);
      }
      if (hasDuplicates(cover.sourceOutputALabels)) {
        return coverFailure('EXPORT_COVER_001', `${field}.sourceOutputALabels`);
      }

      const rowByOutputAId = new Map(rows.map((row) => [row.outputAId, row]));
      for (let sourceIndex = 0; sourceIndex < cover.sourceOutputAIds.length; sourceIndex += 1) {
        const outputAId = cover.sourceOutputAIds[sourceIndex]!;
        const row = rowByOutputAId.get(outputAId);
        if (!row) {
          return coverFailure(
            'EXPORT_COVER_001',
            plan.scope.scopeDetail === 'complete_project'
              ? 'packaging.selection.covers'
              : `${field}.sourceOutputAIds`,
          );
        }
        if (cover.sourceOutputALabels[sourceIndex] !== row.outputALabel) {
          return coverFailure(
            'EXPORT_COVER_001',
            plan.scope.scopeDetail === 'complete_project'
              ? 'packaging.selection.covers'
              : `${field}.sourceOutputALabels`,
          );
        }
      }

      const expectedIds = rows.map((row) => row.outputAId);
      const expectedLabels = rows.map((row) => row.outputALabel);
      const actualIds = new Set(cover.sourceOutputAIds);
      if (
        expectedIds.length === 0 ||
        cover.sourceOutputAIds.length !== expectedIds.length ||
        expectedIds.some((outputAId) => !actualIds.has(outputAId))
      ) {
        return coverFailure('EXPORT_COVER_001', `${field}.sourceOutputAIds`);
      }
      normalizedCover = canonicalCover(cover, expectedIds, expectedLabels);
    } else {
      if (cover.sourceOutputAIds.length !== cover.sourceOutputALabels.length) {
        return coverFailure('EXPORT_COVERCOUNT_001', `${field}.sourceOutputALabels`);
      }
      if (cover.metadata.mockupCount !== cover.sourceOutputAIds.length) {
        return coverFailure('EXPORT_COVERCOUNT_001', `${field}.metadata.mockupCount`);
      }
      if (hasDuplicates(cover.sourceOutputAIds)) {
        return coverFailure('EXPORT_COVER_001', `${field}.sourceOutputAIds`);
      }
    }

    result.set(cover.sessionId, normalizedCover);
    canonicalCovers.push(normalizedCover);
  }
  const selectedSessionOrder = plan.scope.sessionIds.filter((sessionId) => result.has(sessionId));
  const expectedCoverIds = plan.scope.coverIds.filter(
    (coverId) =>
      !hasApprovedGeneralOmission(
        plan,
        'cover',
        coverId,
        plan.scope.sessionIds.map((sessionId) => `source.project.sessions.${sessionId}.cover`),
      ),
  );
  if (
    !arraysEqual(
      plan.selection.covers.map((cover) => cover.sessionId),
      selectedSessionOrder,
    ) ||
    !arraysEqual(
      plan.selection.covers.map((cover) => cover.id),
      expectedCoverIds,
    )
  ) {
    return coverFailure('EXPORT_COVER_001', 'packaging.selection.covers');
  }
  for (const sessionId of plan.scope.sessionIds) {
    const selected = result.get(sessionId);
    const field = `source.project.sessions.${sessionId}.cover`;
    const matchingOmissions = plan.omissions.filter(
      (omission) => omission.artifactKind === 'cover' && omission.field === field,
    );
    if (selected !== undefined) {
      if (matchingOmissions.length !== 0) {
        return coverFailure('EXPORT_COVER_001', 'packaging.selection.covers');
      }
      continue;
    }
    if (
      matchingOmissions.length !== 1 ||
      !hasApprovedGeneralOmission(plan, 'cover', matchingOmissions[0]!.entityId, field) ||
      (!plan.scope.coverIds.some((coverId) => coverId === matchingOmissions[0]!.entityId) &&
        matchingOmissions[0]!.entityId !== `${sessionId}:cover`)
    ) {
      return coverFailure('EXPORT_COVER_001', 'packaging.selection.covers');
    }
  }
  const coverOmissions = plan.omissions.filter((omission) => omission.artifactKind === 'cover');
  if (
    coverOmissions.some(
      (omission) =>
        !plan.scope.sessionIds.some(
          (sessionId) => omission.field === `source.project.sessions.${sessionId}.cover`,
        ),
    )
  ) {
    return coverFailure('EXPORT_COVER_001', 'packaging.selection.covers');
  }
  return { ok: true, covers: result, canonicalCovers: Object.freeze(canonicalCovers) };
}

interface SessionMetadataFailure {
  readonly code: 'EXPORT_NUM_001' | 'EXPORT_COVER_001' | 'EXPORT_MISSINGA_001';
  readonly field: string;
}

/**
 * Reconcile every persisted session counter/flag with the already-validated
 * session entities. Raw session metadata is never accepted as its own proof.
 */
function preciseSessionMetadataFailure(
  sessions: Map<SessionId, ExportSelectedSession>,
  scenes: Map<SessionId, Map<SceneId, SelectedScene>>,
  outputsA: Map<SessionId, ExportSelectedOutputA[]>,
  outputsB: Map<SessionId, ExportSelectedOutputB[]>,
  covers: Map<SessionId, SelectedCover>,
): SessionMetadataFailure | null {
  for (const [sessionId, session] of sessions) {
    const field = `packaging.selection.sessions.${sessionId}`;
    const sceneCount = scenes.get(sessionId)?.size ?? 0;
    const generatedOutputACount = (outputsA.get(sessionId) ?? []).filter(
      (output) => output.status === OutputStatus.Generated,
    ).length;
    const generatedOutputBCount = (outputsB.get(sessionId) ?? []).filter(
      (output) => output.status === OutputStatus.Generated,
    ).length;
    const coverGenerated = covers.get(sessionId)?.status === OutputStatus.Generated;
    const allOutputAReady = sceneCount > 0 && generatedOutputACount === sceneCount;

    if (session.requestedSceneCount !== sceneCount) {
      return { code: 'EXPORT_NUM_001', field: `${field}.requestedSceneCount` };
    }
    if (session.generationProgress.totalScenes !== sceneCount) {
      return { code: 'EXPORT_NUM_001', field: `${field}.generationProgress.totalScenes` };
    }
    if (session.generationProgress.outputAGenerated !== generatedOutputACount) {
      return {
        code: 'EXPORT_NUM_001',
        field: `${field}.generationProgress.outputAGenerated`,
      };
    }
    if (session.generationProgress.outputBGenerated !== generatedOutputBCount) {
      return {
        code: 'EXPORT_NUM_001',
        field: `${field}.generationProgress.outputBGenerated`,
      };
    }
    if (session.generationProgress.coverGenerated !== coverGenerated) {
      return {
        code: 'EXPORT_COVER_001',
        field: `${field}.generationProgress.coverGenerated`,
      };
    }
    if (session.generationProgress.allOutputAReady !== allOutputAReady) {
      return {
        code: 'EXPORT_MISSINGA_001',
        field: `${field}.generationProgress.allOutputAReady`,
      };
    }
  }
  return null;
}

/**
 * Construct the final trusted plan field-by-field. The only normalized field
 * is generated-cover source order, which is rebuilt from canonical numbering.
 */
function planWithCanonicalCovers(plan: ExportPlan, covers: readonly SelectedCover[]): ExportPlan {
  const selection = Object.freeze({
    project: plan.selection.project,
    sessions: plan.selection.sessions,
    groups: plan.selection.groups,
    groupPlans: plan.selection.groupPlans,
    scenes: plan.selection.scenes,
    outputsA: plan.selection.outputsA,
    outputsB: plan.selection.outputsB,
    covers: Object.freeze([...covers]),
    artworks: plan.selection.artworks,
    products: plan.selection.products,
    seasons: plan.selection.seasons,
    colors: plan.selection.colors,
    validationResults: plan.selection.validationResults,
    versions: plan.selection.versions,
    executionPlans: plan.selection.executionPlans,
    ordered: plan.selection.ordered,
  });
  return Object.freeze({
    scope: plan.scope,
    numbering: plan.numbering,
    groupNumbering: plan.groupNumbering,
    selection,
    provenance: plan.provenance,
    omissions: plan.omissions,
    issues: plan.issues,
    partial: plan.partial,
  });
}

function validateArtworks(plan: ExportPlan): Map<string, SelectedArtwork> | null {
  if (plan.omissions.some((omission) => omission.artifactKind === 'artwork_metadata')) {
    return null;
  }
  if (!plan.scope.policy.artworkMetadata) {
    return plan.selection.artworks.length === 0 ? new Map() : null;
  }
  const expectedIds: string[] = [];
  for (const outputB of plan.selection.outputsB) {
    if (!expectedIds.includes(outputB.artworkId)) expectedIds.push(outputB.artworkId);
  }
  if (
    !arraysEqual(
      plan.selection.artworks.map((artwork) => artwork.id),
      expectedIds,
    )
  ) {
    return null;
  }
  const result = buildUniqueMap(plan.selection.artworks, (artwork) => artwork.id);
  if (!result) return null;
  return [...result.values()].every((artwork) => artwork.projectId === plan.scope.projectId)
    ? result
    : null;
}

function validateVersions(plan: ExportPlan): Map<string, SelectedVersion> | null {
  if (!plan.scope.policy.versionMetadata) {
    return plan.selection.versions.length === 0 ? new Map() : null;
  }
  if (
    !arraysEqual(
      plan.selection.versions.map((version) => version.versionId),
      plan.scope.versionIds,
    )
  ) {
    return null;
  }
  const result = buildUniqueMap(plan.selection.versions, (version) => version.versionId);
  if (!result) return null;
  return [...result.values()].every((version) => version.projectId === plan.scope.projectId)
    ? result
    : null;
}

function validateValidationResults(
  plan: ExportPlan,
  sessions: Map<SessionId, ExportSelectedSession>,
): Map<SessionId, Map<string, SelectedValidationResult>> | null {
  if (!plan.scope.policy.validationResults) {
    return plan.selection.validationResults.length === 0 ? new Map() : null;
  }
  const expected: readonly (readonly [string, SessionId])[] = plan.scope.sessionIds.flatMap(
    (sessionId) =>
      (sessions.get(sessionId)?.validationResultIds ?? []).map(
        (validationId) => [validationId, sessionId] as const,
      ),
  );
  if (plan.selection.validationResults.length !== expected.length) return null;
  const result = new Map<SessionId, Map<string, SelectedValidationResult>>();
  for (let index = 0; index < expected.length; index += 1) {
    const validation = plan.selection.validationResults[index]!;
    const [expectedId, expectedSessionId] = expected[index]!;
    if (
      validation.id !== expectedId ||
      validation.sessionId !== expectedSessionId ||
      !setNested(result, validation.sessionId, validation.id, validation)
    ) {
      return null;
    }
  }
  return result;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}

function idsAreCanonical(values: readonly string[]): boolean {
  return arraysEqual(values, sortedUnique(values));
}

interface SupportingMetadataValidation {
  readonly products: Map<string, SelectedProduct>;
  readonly seasons: Map<string, SelectedSeason>;
  readonly colors: Map<string, SelectedColor>;
}

function validateSupportingMetadata(plan: ExportPlan): SupportingMetadataValidation | null {
  const productIds = plan.selection.products.map((product) => product.id);
  const seasonIds = plan.selection.seasons.map((season) => season.id);
  const colorIds = plan.selection.colors.map((color) => color.id);
  if (!idsAreCanonical(productIds) || !idsAreCanonical(seasonIds) || !idsAreCanonical(colorIds)) {
    return null;
  }

  const requiredProducts = sortedUnique([
    ...plan.selection.sessions.flatMap((session) => session.productIds),
    ...plan.selection.scenes.map((scene) => scene.productId),
    ...plan.selection.covers.flatMap((cover) => [
      ...cover.metadata.productIds,
      cover.metadata.primaryProduct,
    ]),
  ]);
  const requiredSeasons = sortedUnique([
    ...plan.selection.sessions.map((session) => session.seasonId),
    ...plan.selection.scenes.map((scene) => scene.seasonId),
    ...plan.selection.covers.map((cover) => cover.metadata.seasonId),
  ]);
  const requiredColors = sortedUnique([
    ...plan.selection.sessions.flatMap((session) => session.colorSelection.colorIds),
    ...plan.selection.scenes.map((scene) => scene.paletteColorId),
    ...plan.selection.outputsA.map((outputA) => outputA.color),
    ...plan.selection.covers.flatMap((cover) => [
      ...cover.metadata.colors,
      cover.metadata.primaryColor,
    ]),
  ]);

  // Some narrow scopes intentionally omit session/scene metadata while still
  // carrying the planner's canonical supporting descriptors. In those scopes
  // there is no downstream relationship anchor from which packaging can
  // independently re-derive product/season/color ids, so preserve the
  // already-snapshotted canonical selection. Where anchors do exist, require
  // exact selected-or-omitted reconciliation.
  const expectedProducts =
    requiredProducts.length === 0
      ? productIds
      : requiredProducts.filter(
          (id) =>
            !hasApprovedGeneralOmission(plan, 'product_metadata', id, `source.products.${id}`),
        );
  const expectedSeasons =
    requiredSeasons.length === 0
      ? seasonIds
      : requiredSeasons.filter(
          (id) => !hasApprovedGeneralOmission(plan, 'season_metadata', id, `source.seasons.${id}`),
        );
  const expectedColors =
    requiredColors.length === 0
      ? colorIds
      : requiredColors.filter(
          (id) => !hasApprovedGeneralOmission(plan, 'color_metadata', id, `source.colors.${id}`),
        );
  const metadataOmissionIsInvalid = (
    artifactKind: 'product_metadata' | 'season_metadata' | 'color_metadata',
    requiredIds: readonly string[],
    fieldPrefix: 'source.products' | 'source.seasons' | 'source.colors',
  ): boolean =>
    plan.omissions
      .filter((omission) => omission.artifactKind === artifactKind)
      .some(
        (omission) =>
          (requiredIds.length > 0 && !requiredIds.includes(omission.entityId)) ||
          !hasApprovedGeneralOmission(
            plan,
            artifactKind,
            omission.entityId,
            `${fieldPrefix}.${omission.entityId}`,
          ),
      );

  if (
    !arraysEqual(productIds, expectedProducts) ||
    !arraysEqual(seasonIds, expectedSeasons) ||
    !arraysEqual(colorIds, expectedColors) ||
    metadataOmissionIsInvalid('product_metadata', requiredProducts, 'source.products') ||
    metadataOmissionIsInvalid('season_metadata', requiredSeasons, 'source.seasons') ||
    metadataOmissionIsInvalid('color_metadata', requiredColors, 'source.colors')
  ) {
    return null;
  }
  return {
    products: buildUniqueMap(plan.selection.products, (product) => product.id)!,
    seasons: buildUniqueMap(plan.selection.seasons, (season) => season.id)!,
    colors: buildUniqueMap(plan.selection.colors, (color) => color.id)!,
  };
}

function sameOrderedReference(
  actual: ExportPlan['selection']['ordered'][number],
  expected: ExportPlan['selection']['ordered'][number],
): boolean {
  return (
    actual.kind === expected.kind &&
    actual.entityId === expected.entityId &&
    actual.sessionId === expected.sessionId &&
    actual.sceneId === expected.sceneId &&
    actual.label === expected.label
  );
}

function validateOrdered(plan: ExportPlan): boolean {
  const expected: ExportPlan['selection']['ordered'][number][] = [];
  if (plan.selection.project !== null) {
    expected.push({ kind: 'project', entityId: plan.selection.project.id });
  }
  // The planner's canonical reference stream is session-major, with each
  // session's groups/scenes/outputs/plans/cover adjacent. Reconstruct that
  // order from the validated session scope rather than grouping by kind,
  // which is observably wrong once more than one session is selected.
  for (const sessionId of plan.scope.sessionIds) {
    for (const session of plan.selection.sessions) {
      if (session.id === sessionId) {
        expected.push({ kind: 'session', entityId: session.id, sessionId: session.id });
      }
    }
    for (const group of plan.selection.groups) {
      if (group.sessionId === sessionId) {
        expected.push({ kind: 'group', entityId: group.id, sessionId: group.sessionId });
      }
    }
    for (const scene of plan.selection.scenes) {
      if (scene.sessionId === sessionId) {
        expected.push({
          kind: 'scene',
          entityId: scene.id,
          sessionId: scene.sessionId,
          sceneId: scene.id,
        });
      }
    }
    for (const outputA of plan.selection.outputsA) {
      if (outputA.sessionId === sessionId) {
        expected.push({
          kind: 'output_a',
          entityId: outputA.id,
          sessionId: outputA.sessionId,
          sceneId: outputA.sceneId,
          label: outputA.label,
        });
      }
    }
    for (const outputB of plan.selection.outputsB) {
      if (outputB.sessionId === sessionId) {
        expected.push({
          kind: 'output_b',
          entityId: outputB.id,
          sessionId: outputB.sessionId,
          sceneId: outputB.sceneId,
          label: outputB.label,
        });
      }
    }
    for (const executionPlan of plan.selection.executionPlans) {
      if (executionPlan.sessionId === sessionId) {
        expected.push({
          kind: 'execution_plan',
          entityId: executionPlan.sessionId,
          sessionId: executionPlan.sessionId,
        });
      }
    }
    for (const cover of plan.selection.covers) {
      if (cover.sessionId === sessionId) {
        expected.push({ kind: 'cover', entityId: cover.id, sessionId: cover.sessionId });
      }
    }
  }
  for (const version of plan.selection.versions) {
    expected.push({ kind: 'version_snapshot', entityId: version.versionId });
  }
  return (
    plan.selection.ordered.length === expected.length &&
    plan.selection.ordered.every((entry, index) => sameOrderedReference(entry, expected[index]!))
  );
}

function validateProvenance(plan: ExportPlan): boolean {
  if (plan.selection.sessions.length > 0) {
    const firstSession = plan.selection.sessions[0]!;
    // Selected scene snapshots are the precise, ordered anchors for the
    // resolved scene sequence. A session fingerprint is an aggregate source
    // record and may legitimately predate a later fixture-expanded scene
    // list; it must not collapse or truncate the authoritative per-scene
    // provenance carried by the selected scenes themselves.
    const expectedSceneFingerprints =
      plan.selection.scenes.length > 0
        ? plan.selection.scenes.map((scene) => scene.sceneFingerprint)
        : plan.selection.sessions.flatMap((session) => session.fingerprint.sceneFingerprints);
    if (
      plan.provenance.sessionFingerprint !== firstSession.fingerprint.hash ||
      !arraysEqual(plan.provenance.sceneFingerprints, expectedSceneFingerprints)
    ) {
      return false;
    }
  } else if (
    plan.selection.scenes.length > 0 &&
    !arraysEqual(
      plan.provenance.sceneFingerprints,
      plan.selection.scenes.map((scene) => scene.sceneFingerprint),
    )
  ) {
    return false;
  }

  if (
    plan.selection.covers.length > 0 &&
    plan.provenance.coverHash !== plan.selection.covers[0]!.coverHash
  ) {
    return false;
  }
  return true;
}

function validateEvidence(plan: ExportPlan): boolean {
  if (plan.partial !== plan.omissions.length > 0) return false;
  for (const omission of plan.omissions) {
    const duplicates = plan.omissions.filter(
      (candidate) =>
        candidate.artifactKind === omission.artifactKind &&
        candidate.entityId === omission.entityId &&
        candidate.field === omission.field,
    );
    const expectedIssue = registeredExportFailure(omission.code, omission.field);
    const matchingIssues = plan.issues.filter(
      (issue) => issue.code === omission.code && issue.field === omission.field,
    );
    if (
      duplicates.length !== 1 ||
      !expectedIssue ||
      matchingIssues.length !== 1 ||
      !exactFailureMatches(matchingIssues[0]!, expectedIssue)
    )
      return false;
  }
  return true;
}

/**
 * Validate in the exact frozen precedence and construct the trusted indexes
 * consumed by package content assembly.
 */
export function validatePackagePlanIntegrity(
  plan: ExportPlan,
  limits: ExportSafetyLimits,
): PackagePlanValidationResult {
  let trustedPlan: ExportPlan;
  try {
    trustedPlan = snapshotTrustedPlan(plan);
  } catch {
    return failure('EXPORT_CORRUPT_001', 'packaging.input');
  }

  const scopeKindField = preciseScopeKindFieldFailure(trustedPlan);
  if (scopeKindField) return failure('EXPORT_SCOPE_001', scopeKindField);

  if (hasScopePolicyViolation(trustedPlan)) {
    return failure('EXPORT_SCOPE_001', 'packaging.scope.policy');
  }

  const scopeField = preciseScopeFailure(trustedPlan);
  if (scopeField) return failure('EXPORT_SCOPE_001', scopeField);
  if (!validateProject(trustedPlan)) {
    return failure('EXPORT_SCOPE_001', 'packaging.selection.project');
  }
  const sessions = validateSessionsAndAllowedScenes(trustedPlan);
  if (!sessions) return failure('EXPORT_SCOPE_001', 'packaging.selection.sessions');
  const scenes = validateScenes(trustedPlan, sessions.allowedScenes);
  if (!scenes) return failure('EXPORT_SCOPE_001', 'packaging.selection.scenes');

  const numbering = validateNumbering(trustedPlan, sessions.allowedScenes, limits);
  if (!numbering) return failure('EXPORT_LINK_001', 'packaging.numbering');

  const groups = validateGroups(trustedPlan, sessions.allowedScenes, numbering.nested, limits);
  if (!groups) return failure('EXPORT_GROUP_001', 'packaging.groupNumbering');

  if (hasMissingSelectedADependency(trustedPlan)) {
    return failure('EXPORT_LINK_001', 'packaging.selection.outputsB');
  }
  const outputsA = validateSelectedA(trustedPlan, sessions.allowedScenes, numbering.nested, limits);
  if (!outputsA) return failure('EXPORT_LINK_001', 'packaging.selection.outputsA');

  const outputsB = validateSelectedB(
    trustedPlan,
    sessions.allowedScenes,
    numbering.nested,
    outputsA.nested,
    limits,
  );
  if (!outputsB) return failure('EXPORT_LINK_001', 'packaging.selection.outputsB');

  const artworks = validateArtworks(trustedPlan);
  if (!artworks) return failure('EXPORT_LINK_001', 'packaging.selection.artworks');
  const executionPlans = validateExecutionPlans(trustedPlan, numbering.grouped);
  if (!executionPlans) {
    return failure('EXPORT_LINK_001', 'packaging.selection.executionPlans');
  }
  const covers = validateCovers(trustedPlan, numbering.grouped);
  if (!covers.ok) return failure(covers.code, covers.field);

  const sessionMetadataFailure = preciseSessionMetadataFailure(
    sessions.sessions,
    scenes,
    outputsA.grouped,
    outputsB.grouped,
    covers.covers,
  );
  if (sessionMetadataFailure) {
    return failure(sessionMetadataFailure.code, sessionMetadataFailure.field);
  }

  const versions = validateVersions(trustedPlan);
  if (!versions) return failure('EXPORT_SCOPE_001', 'packaging.selection.versions');
  const validationResults = validateValidationResults(trustedPlan, sessions.sessions);
  if (!validationResults) {
    return failure('EXPORT_LINK_001', 'packaging.selection.validationResults');
  }
  const supporting = validateSupportingMetadata(trustedPlan);
  if (!supporting) return failure('EXPORT_LINK_001', 'packaging.selection.products');
  if (!validateOrdered(trustedPlan)) {
    return failure('EXPORT_LINK_001', 'packaging.selection.ordered');
  }
  if (!validateProvenance(trustedPlan)) {
    return failure('EXPORT_LINK_001', 'packaging.provenance');
  }
  if (!validateEvidence(trustedPlan)) {
    return failure('EXPORT_CORRUPT_001', 'packaging.omissions');
  }

  const groupPlans = new Map<SessionId, SelectedGroupPlan[]>();
  for (const groupPlan of trustedPlan.selection.groupPlans) {
    pushGrouped(groupPlans, groupPlan.sessionId, groupPlan);
  }
  trustedPlan = planWithCanonicalCovers(trustedPlan, covers.canonicalCovers);

  return {
    ok: true,
    value: Object.freeze({
      plan: trustedPlan,
      numberingBySessionAndScene: readonlyNestedMap(numbering.nested),
      outputABySessionAndScene: readonlyNestedMap(outputsA.nested),
      outputBBySessionAndScene: readonlyNestedMap(outputsB.nested),
      groupsBySessionAndId: readonlyNestedMap(groups.groups),
      groupNumberingBySessionAndGroup: readonlyNestedMap(groups.rows),
      sessionsById: readonlyMap(sessions.sessions),
      scenesBySessionAndId: readonlyNestedMap(scenes),
      executionPlansBySession: readonlyMap(executionPlans),
      coversBySession: readonlyMap(covers.covers),
      groupPlansBySession: readonlyGroupedMap(groupPlans),
      artworksById: readonlyMap(artworks),
      productsById: readonlyMap(supporting.products),
      seasonsById: readonlyMap(supporting.seasons),
      colorsById: readonlyMap(supporting.colors),
      validationResultsBySessionAndId: readonlyNestedMap(validationResults),
      versionsById: readonlyMap(versions),
      outputsABySession: readonlyGroupedMap(outputsA.grouped),
      outputsBBySession: readonlyGroupedMap(outputsB.grouped),
      numberingBySession: readonlyGroupedMap(numbering.grouped),
    }),
  };
}
