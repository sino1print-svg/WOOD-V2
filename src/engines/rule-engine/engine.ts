import {
  RuleEffectType,
  ValidationSeverity,
  type DroppedRule,
  type IsoTimestamp,
  type ResolvedConstraint,
  type ResolvedRule,
  type Rule,
  type RuleId,
  type RuleSetId,
  type RuleTrace,
  type RuleTraceEntry,
  type Sha256,
  type ValidationFailure,
} from '../../shared/domain-model';
import { APP_CONFIG } from '../../config/app-config';
import { ERROR_BY_CODE } from '../../shared/errors';
import { validateRuleSetShape, validateRuleShape } from '../../shared/rule-schema-validation';
import { evaluateCondition } from './conditions';
import { detectCyclicInput } from './context';
import { validateDomainIsolation } from './domains';
import { bilingualForCode, failureFromCode } from './failures';
import { evaluateNumericExpression } from './numeric';
import { resolveRuleTarget } from './resolve';
import { sha256Hex, stableJson } from './stable';
import type { RuleEngineInput, RuleEngineResult, RuleEngineSafetyLimits } from './types';

interface EvaluatedRule {
  readonly rule: Rule;
  readonly ruleSetIds: readonly RuleSetId[];
  readonly matched: boolean;
  readonly targets: ResolvedRule['effect']['targets'];
  readonly limit: number | null;
  readonly resultCode: string | null;
}

interface BucketItem {
  readonly evaluated: EvaluatedRule;
  readonly targetIndex: number;
  readonly values: readonly string[];
}

const EFFECT_STRENGTH: Record<RuleEffectType, number> = {
  [RuleEffectType.Forbid]: 0,
  [RuleEffectType.Lock]: 1,
  [RuleEffectType.Limit]: 2,
  [RuleEffectType.Require]: 3,
};

function compareLex(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortRules(a: Rule, b: Rule): number {
  return a.priority - b.priority || compareLex(String(a.id), String(b.id));
}

function emptyTrace(
  contextHash: Sha256,
  evaluatedAt: IsoTimestamp,
  failures: readonly ValidationFailure[],
): RuleTrace {
  return {
    contextHash,
    evaluatedAt,
    entries: [],
    droppedByPriority: [],
    outcome: failures.length > 0 ? 'blocked' : 'passed',
    failures: [...failures],
  };
}

function contextHash(input: RuleEngineInput): Sha256 {
  return sha256Hex(stableJson(input.context)) as Sha256;
}

function isValidIsoTimestamp(value: unknown): value is IsoTimestamp {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1]!;
}

function validateInput(
  input: RuleEngineInput,
  limits: RuleEngineSafetyLimits,
): readonly ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  if (!isValidIsoTimestamp(input.evaluatedAt)) {
    failures.push(failureFromCode('RULE_CFG_001', 'evaluatedAt', null));
  }
  const session = (input.context as unknown as { session?: unknown }).session;
  if (typeof session !== 'object' || session === null) {
    failures.push(failureFromCode('RULE_CFG_001', 'context.session', null));
    return failures;
  }
  const sessionRecord = session as Record<string, unknown>;
  if (typeof sessionRecord.audience !== 'string' || sessionRecord.audience.length === 0) {
    failures.push(failureFromCode('RULE_AUD_003', 'session.audience', null));
  }
  if (typeof sessionRecord.season !== 'string' || sessionRecord.season.length === 0) {
    failures.push(failureFromCode('RULE_SEA_005', 'session.season', null));
  }
  // CORRECTIVE #4: productIds is a mandatory EvaluationContext field per
  // 04_RULE_ENGINE_REVISED §4.2 ("PRODUCT (scoped: productIds)") — evaluation
  // must not begin without it. No dedicated catalog code exists for this
  // specific pre-flight gap, so the generic structural config code is used,
  // consistent with the other RULE_CFG_001 usages in this function.
  if (
    !Array.isArray(sessionRecord.productIds) ||
    (sessionRecord.productIds as unknown[]).length === 0
  ) {
    failures.push(failureFromCode('RULE_CFG_001', 'session.productIds', null));
  }
  const colorSelection = sessionRecord.colorSelection;
  if (
    typeof colorSelection !== 'object' ||
    colorSelection === null ||
    !Array.isArray((colorSelection as Record<string, unknown>).colorIds) ||
    ((colorSelection as Record<string, unknown>).colorIds as unknown[]).length === 0
  ) {
    failures.push(failureFromCode('RULE_PAL_003', 'session.colorSelection.colorIds', null));
  }
  if (
    typeof sessionRecord.requestedSceneCount !== 'number' ||
    !Number.isFinite(sessionRecord.requestedSceneCount) ||
    sessionRecord.requestedSceneCount < 1
  ) {
    failures.push(failureFromCode('RULE_CNT_002', 'session.requestedSceneCount', null));
  }
  if (input.rules.length > limits.maxRules) {
    failures.push(failureFromCode('RE_INTERNAL_LIMIT', 'rules', null));
    return failures;
  }
  const ruleById = new Map<string, Rule>();
  for (const [index, ruleValue] of input.rules.entries()) {
    const schemaIssues = validateRuleShape(ruleValue);
    if (schemaIssues.length > 0) {
      for (const issue of schemaIssues) {
        failures.push(
          failureFromCode('RULE_CFG_001', `rules/${index}${issue.jsonPointer}`, null, {
            detail: `${issue.keyword}: ${issue.message}`,
          }),
        );
      }
      continue;
    }
    const rule = ruleValue as Rule;
    const id = String(rule.id);
    if (ruleById.has(id)) {
      failures.push(failureFromCode('RULE_CFG_001', `rules/${index}/id`, rule.id));
      continue;
    }
    ruleById.set(id, rule);
    if (rule.effect.targets.length === 0 || rule.effect.targets.length > limits.maxTargetsPerRule) {
      failures.push(failureFromCode('RE_INTERNAL_LIMIT', `rules/${index}/effect/targets`, rule.id));
    }
    const isolation = validateDomainIsolation(rule);
    if (isolation) {
      failures.push(isolation);
      continue;
    }
  }
  const seenSetIds = new Set<string>();
  for (const [index, ruleSetValue] of input.activeRuleSets.entries()) {
    const schemaIssues = validateRuleSetShape(ruleSetValue);
    if (schemaIssues.length > 0) {
      for (const issue of schemaIssues) {
        failures.push(
          failureFromCode('RULE_CFG_001', `activeRuleSets/${index}${issue.jsonPointer}`, null, {
            detail: `${issue.keyword}: ${issue.message}`,
          }),
        );
      }
      continue;
    }
    const ruleSet = ruleSetValue;
    if (ruleSet.schemaVersion !== APP_CONFIG.schemaVersions.ruleSet) {
      failures.push(failureFromCode('RULE_CFG_001', `activeRuleSets/${index}/schemaVersion`, null));
      continue;
    }
    if (seenSetIds.has(String(ruleSet.id))) {
      failures.push(failureFromCode('RULE_CFG_001', `activeRuleSets/${index}/id`, null));
    }
    seenSetIds.add(String(ruleSet.id));
    const seenRuleIds = new Set<string>();
    for (const [ruleIndex, ruleId] of ruleSet.ruleIds.entries()) {
      const id = String(ruleId);
      if (seenRuleIds.has(id) || !ruleById.has(id)) {
        failures.push(
          failureFromCode('RULE_CFG_002', `activeRuleSets/${index}/ruleIds/${ruleIndex}`, ruleId),
        );
      }
      seenRuleIds.add(id);
    }
  }
  return failures.sort(
    (a, b) =>
      compareLex(a.code, b.code) || compareLex(String(a.ruleId ?? ''), String(b.ruleId ?? '')),
  );
}

function scopedRules(input: RuleEngineInput): Array<{ rule: Rule; ruleSetIds: RuleSetId[] }> {
  const byId = new Map(input.rules.map((rule) => [String(rule.id), rule]));
  const memberships = new Map<string, Set<RuleSetId>>();
  for (const ruleSet of [...input.activeRuleSets].sort((a, b) =>
    compareLex(String(a.id), String(b.id)),
  )) {
    for (const ruleId of ruleSet.ruleIds) {
      const id = String(ruleId);
      const set = memberships.get(id) ?? new Set<RuleSetId>();
      set.add(ruleSet.id);
      memberships.set(id, set);
    }
  }
  return [...memberships.entries()]
    .map(([id, sets]) => ({
      rule: byId.get(id)!,
      ruleSetIds: [...sets].sort((a, b) => compareLex(String(a), String(b))),
    }))
    .sort((a, b) => sortRules(a.rule, b.rule));
}

function resolveRules(
  input: RuleEngineInput,
  limits: RuleEngineSafetyLimits,
): { readonly rules: readonly EvaluatedRule[]; readonly failures: readonly ValidationFailure[] } {
  const evaluated: EvaluatedRule[] = [];
  const failures: ValidationFailure[] = [];
  for (const scoped of scopedRules(input)) {
    const condition = evaluateCondition(scoped.rule.condition, input.context, limits);
    if (!condition.ok) {
      failures.push({
        ...condition.failure,
        ruleId: scoped.rule.id,
        priorityClass: scoped.rule.priority,
        domain: scoped.rule.domain,
      });
      continue;
    }
    const targets: ResolvedRule['effect']['targets'][number][] = [];
    for (const target of scoped.rule.effect.targets) {
      const resolved = resolveRuleTarget(target, input.context, limits);
      if (!resolved.ok) {
        failures.push({
          ...resolved.failure,
          ruleId: scoped.rule.id,
          priorityClass: scoped.rule.priority,
          domain: scoped.rule.domain,
        });
        continue;
      }
      targets.push(resolved.value);
    }
    let limit: number | null = null;
    if (scoped.rule.effect.limit !== undefined) {
      const resolved = evaluateNumericExpression(scoped.rule.effect.limit, input.context, limits);
      if (!resolved.ok) {
        failures.push({
          ...resolved.failure,
          ruleId: scoped.rule.id,
          priorityClass: scoped.rule.priority,
          domain: scoped.rule.domain,
        });
        continue;
      }
      limit = resolved.value;
    }
    evaluated.push({
      rule: scoped.rule,
      ruleSetIds: scoped.ruleSetIds,
      matched: condition.value,
      targets,
      limit,
      resultCode: null,
    });
  }
  return { rules: evaluated, failures };
}

/**
 * CORRECTIVE #2 v1 keyed buckets on the exact sorted resolved-value ARRAY.
 * That correctly merged a Literal `'black'` target with a ContextRef
 * resolving to `['black']` (the v1 example), but it silently broke the
 * pre-existing Lock/Require exclusion semantics: two Locks resolving to
 * *different* value sets (e.g. `{black,white}` vs `{black,navy}`, RE
 * §3.5's own worked example "Two Locks intersect") no longer shared a
 * bucket at all, because their resolved arrays are not identical — so
 * `lockedTo` intersection and "Require value excluded by winning Lock"
 * became structurally unreachable.
 *
 * CORRECTIVE #2 v2: bucket membership is now the connected components of an
 * OVERLAP relation — two resolved targets in the same `RuleDomain` are in
 * the same bucket iff their resolved value sets share at least one value
 * (transitively). This is strictly more correct than exact-array equality
 * (equality is a special case of overlap) and recovers both requirements at
 * once:
 *  - Literal `'black'` and ContextRef → `['black']` share `'black'` ⇒ same
 *    bucket ⇒ conflict (v1/v2 example).
 *  - Lock → `{black,white}` and Lock → `{black,navy}` share `'black'` ⇒ same
 *    bucket ⇒ intersect to `{black}` (RE §3.5 worked example).
 *  - Literal `'black'` and Literal `'navy'` share nothing ⇒ different
 *    buckets ⇒ coexist.
 *
 * Known, documented limit (not a bug — a genuine specification gap): a
 * Require whose value shares NO element with any rule's resolved set in the
 * domain (e.g. Require → `'navy'` vs a Lock that resolved only to
 * `{black,white}`, with nothing else connecting them) cannot be detected as
 * "excluded by the Lock" through bucketing alone, because that would require
 * knowing the full candidate universe for the dimension — which is exactly
 * `RULE_CANDIDATE_SET_CONTRACT_GAP` (Corrective Issue 5), already
 * out of scope. Whenever a Require shares a bucket with a winning Lock
 * (i.e. any value overlap exists at all), the existing exclusion check
 * (`lockedTo`/`requiredValues`) still runs and still blocks correctly.
 */
function resolvedBucketKey(resolved: readonly string[]): string {
  return [...resolved].sort(compareLex).join('\u0000');
}

/** Minimal disjoint-set (union-find) helper for the overlap-clustering below. */
class DisjointSet {
  private readonly parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]!]!;
      x = this.parent[x]!;
    }
    return x;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

function buildBuckets(evaluated: readonly EvaluatedRule[]): Map<string, BucketItem[]> {
  interface Node {
    readonly item: EvaluatedRule;
    readonly targetIndex: number;
    readonly values: readonly string[];
  }
  const nodesByDomain = new Map<string, Node[]>();
  for (const item of evaluated) {
    if (!item.matched) continue;
    if (item.resultCode && ERROR_BY_CODE[item.resultCode]?.severity === ValidationSeverity.Warning)
      continue;

    const list = nodesByDomain.get(item.rule.domain) ?? [];
    if (item.rule.effect.type === RuleEffectType.Lock) {
      const values = [...new Set(item.targets.flatMap((target) => target.resolved))].sort(
        compareLex,
      );
      list.push({ item, targetIndex: 0, values });
    } else {
      item.targets.forEach((target, targetIndex) => {
        list.push({ item, targetIndex, values: target.resolved });
      });
    }
    nodesByDomain.set(item.rule.domain, list);
  }

  const buckets = new Map<string, BucketItem[]>();
  for (const [domain, nodes] of nodesByDomain) {
    const dsu = new DisjointSet(nodes.length);
    const lockIndices = nodes
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => node.item.rule.effect.type === RuleEffectType.Lock)
      .map(({ index }) => index);
    for (let index = 1; index < lockIndices.length; index += 1) {
      dsu.union(lockIndices[0]!, lockIndices[index]!);
    }

    const nodesByValue = new Map<string, number[]>();
    nodes.forEach((node, index) => {
      for (const value of node.values) {
        const indices = nodesByValue.get(value) ?? [];
        indices.push(index);
        nodesByValue.set(value, indices);
      }
    });
    for (const indices of nodesByValue.values()) {
      for (let index = 1; index < indices.length; index += 1) {
        dsu.union(indices[0]!, indices[index]!);
      }
    }

    const componentValues = new Map<number, Set<string>>();
    const componentMembers = new Map<number, string[]>();
    nodes.forEach((node, index) => {
      const root = dsu.find(index);
      const values = componentValues.get(root) ?? new Set<string>();
      for (const value of node.values) values.add(value);
      componentValues.set(root, values);
      const members = componentMembers.get(root) ?? [];
      members.push(`${String(node.item.rule.id)}#${node.targetIndex}`);
      componentMembers.set(root, members);
    });

    nodes.forEach((node, index) => {
      const root = dsu.find(index);
      const componentKey = resolvedBucketKey([...componentValues.get(root)!]);
      const disambiguator = [...componentMembers.get(root)!].sort(compareLex).join(',');
      const key = `${domain}|${componentKey}|${disambiguator}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push({ evaluated: node.item, targetIndex: node.targetIndex, values: node.values });
      buckets.set(key, bucket);
    });
  }
  return buckets;
}

function resolveBuckets(evaluated: readonly EvaluatedRule[]): {
  readonly constraints: readonly ResolvedConstraint[];
  readonly dropped: readonly DroppedRule[];
  readonly failures: readonly ValidationFailure[];
  readonly appliedRuleIds: ReadonlySet<string>;
  readonly overriddenBy: ReadonlyMap<string, string>;
  readonly blockingConflictRuleIds: ReadonlySet<string>;
} {
  const constraints: ResolvedConstraint[] = [];
  const dropped: DroppedRule[] = [];
  const failures: ValidationFailure[] = [];
  const applied = new Set<string>();
  const overriddenBy = new Map<string, string>();
  const blockingConflictRuleIds = new Set<string>();
  const buckets = buildBuckets(evaluated);

  for (const [bucketKey, raw] of [...buckets.entries()].sort(([a], [b]) => compareLex(a, b))) {
    const items = [...raw].sort((a, b) => sortRules(a.evaluated.rule, b.evaluated.rule));
    const winningPriority = items[0]!.evaluated.rule.priority;
    const active = items.filter((item) => item.evaluated.rule.priority === winningPriority);
    const lower = items.filter((item) => item.evaluated.rule.priority !== winningPriority);
    const tiebreakSorted = [...active].sort(
      (a, b) =>
        EFFECT_STRENGTH[a.evaluated.rule.effect.type] -
          EFFECT_STRENGTH[b.evaluated.rule.effect.type] ||
        compareLex(String(a.evaluated.rule.id), String(b.evaluated.rule.id)),
    );
    const primary = tiebreakSorted[0]!;
    for (const item of lower) {
      dropped.push({
        ruleId: item.evaluated.rule.id,
        priority: item.evaluated.rule.priority,
        overriddenBy: primary.evaluated.rule.id,
        reason: 'overridden_by_higher_priority',
      });
      overriddenBy.set(String(item.evaluated.rule.id), String(primary.evaluated.rule.id));
    }

    const forbids = active.filter(
      (item) => item.evaluated.rule.effect.type === RuleEffectType.Forbid,
    );
    const requires = active.filter(
      (item) => item.evaluated.rule.effect.type === RuleEffectType.Require,
    );
    const locks = active.filter((item) => item.evaluated.rule.effect.type === RuleEffectType.Lock);
    const limits = active.filter(
      (item) => item.evaluated.rule.effect.type === RuleEffectType.Limit,
    );

    let blocked = false;
    if (forbids.length > 0 && requires.length > 0) {
      blocked = true;
      failures.push(
        failureFromCode('RE_INTERNAL_CONFLICT', bucketKey, primary.evaluated.rule.id, {
          priority: winningPriority,
          domain: primary.evaluated.rule.domain,
          detail: `require_vs_forbid_same_priority requireRuleId=${requires[0]!.evaluated.rule.id} forbidRuleId=${forbids[0]!.evaluated.rule.id}`,
        }),
      );
    }

    let lockedTo: string[] | null = null;
    for (const lock of locks) {
      const values = lock.values;
      lockedTo =
        lockedTo === null ? [...values] : lockedTo.filter((value) => values.includes(value));
    }
    if (locks.length > 1 && lockedTo?.length === 0) {
      blocked = true;
      failures.push(
        failureFromCode('RE_INTERNAL_CONFLICT', bucketKey, primary.evaluated.rule.id, {
          priority: winningPriority,
          domain: primary.evaluated.rule.domain,
          detail: `lock_intersection_empty ruleIds=${locks
            .map((item) => String(item.evaluated.rule.id))
            .sort(compareLex)
            .join(',')}`,
        }),
      );
    }

    // CORRECTIVE #1: a Require at a LOWER priority than a winning Forbid/Lock
    // in this bucket must still be checked. Per spec 04_RULE_ENGINE_REVISED
    // §3.3 step 5, "Any Require target removed by higher priority ... ⇒
    // BLOCKING." Previously, `lower` items (including Requires) were only
    // ever recorded as `overridden_by_higher_priority` and the engine
    // returned success — silently dropping a Require that had become
    // unsatisfiable. Every Require in the WHOLE bucket (active or dropped
    // by priority) must be checked against the winning Forbid/Lock.
    const lowerRequires = lower.filter(
      (item) => item.evaluated.rule.effect.type === RuleEffectType.Require,
    );
    if (!blocked && lowerRequires.length > 0) {
      const forbidsAllRequires = forbids.length > 0;
      for (const req of lowerRequires) {
        const requiredValues = req.values;
        const impossible =
          forbidsAllRequires ||
          (lockedTo !== null && requiredValues.some((value) => !lockedTo!.includes(value)));
        if (impossible) {
          blocked = true;
          const blockingRule = forbidsAllRequires ? forbids[0]! : locks[0]!;
          blockingConflictRuleIds.add(String(req.evaluated.rule.id));
          failures.push(
            failureFromCode('RE_INTERNAL_CONFLICT', bucketKey, req.evaluated.rule.id, {
              priority: req.evaluated.rule.priority,
              domain: req.evaluated.rule.domain,
              detail: `require_removed_by_higher_priority requireRuleId=${req.evaluated.rule.id} blockedBy=${blockingRule.evaluated.rule.id} blockedByPriority=${blockingRule.evaluated.rule.priority}`,
            }),
          );
        }
      }
    }

    const limitValues = limits
      .map((item) => item.evaluated.limit)
      .filter((v): v is number => v !== null);
    const limit = limitValues.length > 0 ? Math.min(...limitValues) : null;
    const minimumLimits =
      limit === null ? [] : limits.filter((item) => item.evaluated.limit === limit);

    const requiredValues = [...new Set(requires.flatMap((item) => item.values))].sort(compareLex);
    if (
      !blocked &&
      lockedTo !== null &&
      requiredValues.some((required) => !lockedTo!.includes(required))
    ) {
      blocked = true;
      failures.push(
        failureFromCode('RE_INTERNAL_CONFLICT', bucketKey, primary.evaluated.rule.id, {
          priority: winningPriority,
          domain: primary.evaluated.rule.domain,
        }),
      );
    }
    if (!blocked && limit !== null && requiredValues.length > limit) {
      blocked = true;
      failures.push(
        failureFromCode('RE_INTERNAL_CONFLICT', bucketKey, primary.evaluated.rule.id, {
          priority: winningPriority,
          domain: primary.evaluated.rule.domain,
        }),
      );
    }

    const winning: BucketItem[] =
      forbids.length > 0 ? [...forbids] : [...locks, ...minimumLimits, ...requires];
    const winnerIds = new Set(winning.map((item) => String(item.evaluated.rule.id)));
    const fallbackWinner =
      [...winning].sort(
        (a, b) =>
          EFFECT_STRENGTH[a.evaluated.rule.effect.type] -
            EFFECT_STRENGTH[b.evaluated.rule.effect.type] ||
          compareLex(String(a.evaluated.rule.id), String(b.evaluated.rule.id)),
      )[0] ?? primary;

    for (const item of active) {
      if (winnerIds.has(String(item.evaluated.rule.id))) {
        applied.add(String(item.evaluated.rule.id));
      } else {
        const typeWinner =
          item.evaluated.rule.effect.type === RuleEffectType.Limit && minimumLimits.length > 0
            ? [...minimumLimits].sort((a, b) =>
                compareLex(String(a.evaluated.rule.id), String(b.evaluated.rule.id)),
              )[0]!
            : fallbackWinner;
        dropped.push({
          ruleId: item.evaluated.rule.id,
          priority: item.evaluated.rule.priority,
          overriddenBy: typeWinner.evaluated.rule.id,
          reason: 'lost_tiebreak',
        });
        overriddenBy.set(String(item.evaluated.rule.id), String(typeWinner.evaluated.rule.id));
      }
    }
    constraints.push({
      bucketKey,
      domain: primary.evaluated.rule.domain,
      target: primary.evaluated.targets[primary.targetIndex]!.resolved.join('|'),
      forbidden: forbids.length > 0,
      lockedTo:
        forbids.length > 0 || lockedTo === null ? null : [...new Set(lockedTo)].sort(compareLex),
      limit: forbids.length > 0 ? null : limit,
      required: forbids.length === 0 && requires.length > 0,
      winningRuleIds: [...winning]
        .sort((a, b) => compareLex(String(a.evaluated.rule.id), String(b.evaluated.rule.id)))
        .map((item) => item.evaluated.rule.id),
    });
  }
  return {
    constraints,
    dropped: dropped.sort(
      (a, b) => a.priority - b.priority || compareLex(String(a.ruleId), String(b.ruleId)),
    ),
    failures,
    appliedRuleIds: applied,
    overriddenBy,
    blockingConflictRuleIds,
  };
}

function traceEntries(
  evaluated: readonly EvaluatedRule[],
  applied: ReadonlySet<string>,
  overriddenBy: ReadonlyMap<string, string>,
  blockingConflictRuleIds: ReadonlySet<string>,
): readonly RuleTraceEntry[] {
  return evaluated.map((item) => {
    const override = overriddenBy.get(String(item.rule.id)) ?? null;
    const code = item.resultCode;
    const bilingual = code ? bilingualForCode(code) : bilingualForCode('');
    const warning = code ? ERROR_BY_CODE[code]?.severity === ValidationSeverity.Warning : false;
    const isApplied = item.matched && applied.has(String(item.rule.id)) && !warning;
    // CORRECTIVE #1: a Require whose target became impossible because of a
    // higher-priority Forbid/Lock is `overridden` AND a blocking conflict —
    // both facts must be visible in the trace, not silently folded into a
    // generic "overridden" note.
    const isBlockingConflict = blockingConflictRuleIds.has(String(item.rule.id));
    return {
      ruleId: item.rule.id,
      ruleSetIds: item.ruleSetIds,
      priority: item.rule.priority,
      domain: item.rule.domain,
      condition: item.rule.condition,
      matched: item.matched,
      resolvedTargets: item.targets.flatMap((target) => target.resolved),
      resolvedLimit: item.limit,
      effectApplied: isApplied ? item.rule.effect.type : null,
      applied: isApplied,
      overridden: override !== null,
      overriddenBy: override as RuleId | null,
      resultCode: code,
      diagnosticMessageAr: bilingual.messageAr,
      diagnosticMessageEn: bilingual.messageEn,
      severity: bilingual.severity,
      note: !item.matched
        ? 'condition_not_matched'
        : warning
          ? 'warning_only_no_mutation'
          : isBlockingConflict
            ? 'blocking_conflict_require_removed_by_higher_priority'
            : override
              ? 'overridden'
              : isApplied
                ? 'applied'
                : 'not_applied',
    };
  });
}

export function evaluateRules(
  input: RuleEngineInput,
  limits: RuleEngineSafetyLimits = APP_CONFIG.limits.ruleEngine,
): RuleEngineResult {
  const cycle = detectCyclicInput(input);
  if (cycle) {
    return {
      ok: false,
      failures: [cycle],
      trace: emptyTrace('' as Sha256, input.evaluatedAt, [cycle]),
    };
  }
  let hash: Sha256;
  try {
    hash = contextHash(input);
  } catch {
    const failure = failureFromCode('RULE_CFG_001', 'input', null);
    return {
      ok: false,
      failures: [failure],
      trace: emptyTrace('' as Sha256, input.evaluatedAt, [failure]),
    };
  }
  const inputFailures = validateInput(input, limits);
  if (inputFailures.length > 0) {
    return {
      ok: false,
      failures: inputFailures,
      trace: emptyTrace(hash, input.evaluatedAt, inputFailures),
    };
  }
  const resolved = resolveRules(input, limits);
  if (resolved.failures.length > 0) {
    return {
      ok: false,
      failures: resolved.failures,
      trace: emptyTrace(hash, input.evaluatedAt, resolved.failures),
    };
  }
  const bucketed = resolveBuckets(resolved.rules);
  const warnings: ValidationFailure[] = [];
  for (const item of resolved.rules) {
    if (!item.matched || !item.resultCode) continue;
    const entry = ERROR_BY_CODE[item.resultCode];
    if (entry?.severity === ValidationSeverity.Warning) {
      warnings.push(
        failureFromCode(item.resultCode, 'rule', item.rule.id, {
          priority: item.rule.priority,
          domain: item.rule.domain,
        }),
      );
    }
  }
  const allFailures = [...bucketed.failures].sort(
    (a, b) =>
      compareLex(a.code, b.code) || compareLex(String(a.ruleId ?? ''), String(b.ruleId ?? '')),
  );
  const entries = traceEntries(
    resolved.rules,
    bucketed.appliedRuleIds,
    bucketed.overriddenBy,
    bucketed.blockingConflictRuleIds,
  );
  const trace: RuleTrace = {
    contextHash: hash,
    evaluatedAt: input.evaluatedAt,
    entries,
    droppedByPriority: bucketed.dropped,
    outcome: allFailures.length > 0 ? 'blocked' : 'passed',
    failures: allFailures,
  };
  if (allFailures.length > 0) return { ok: false, failures: allFailures, trace };
  const resolvedRules: ResolvedRule[] = resolved.rules.map((item) => ({
    ruleId: item.rule.id,
    priority: item.rule.priority,
    domain: item.rule.domain,
    condition: { source: item.rule.condition, matched: item.matched },
    effect: { type: item.rule.effect.type, targets: item.targets, limit: item.limit },
    appliedResultCode: item.resultCode,
  }));
  return {
    ok: true,
    value: { resolvedRules, constraints: bucketed.constraints, trace },
    warnings: warnings.sort((a, b) => compareLex(a.code, b.code)),
  };
}
