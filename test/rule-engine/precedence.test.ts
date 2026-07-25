import { describe, expect, it } from 'vitest';
import {
  RuleDomain,
  RuleEffectType,
  RulePriorityClass,
  SceneDimension,
  SymbolicTarget,
  type ColorId,
  type ContextFieldPath,
  type EvaluationContext,
  type Rule,
  type RuleId,
} from '../../src/shared/domain-model';
import { evaluateRules, stableJson } from '../../src/engines/rule-engine';
import { context, id, input, rule } from './fixtures';

function withId(base: Rule, value: string): Rule {
  return { ...base, id: id<RuleId>(value) };
}

const target = { kind: 'dimension' as const, dimension: SceneDimension.Composition };
// PrintArea priority may only govern PrintArea/Background/Output domains (Corrective #3);
// Output is also reachable by SceneAesthetic, so it is the domain used below to exercise a
// genuine cross-priority conflict without violating the priority↔domain ownership mapping.
const crossPriorityTarget = {
  kind: 'symbolic' as const,
  symbol: SymbolicTarget.CollageOutput,
};

describe('precedence and conflict resolution', () => {
  it('CORRECTIVE #1: higher priority Forbid removing a lower-priority Require target blocks (was: silently overridden)', () => {
    // OLD (incorrect) expectation: result.ok === true, constraints[0].forbidden === true,
    // and the Require was merely recorded as `overridden_by_higher_priority` — the engine
    // returned success even though the Require's only target had become impossible.
    // NEW (correct) expectation: 04_RULE_ENGINE_REVISED §3.3 step 5 — "Any Require target
    // removed by higher priority ... ⇒ BLOCKING, HALT." The engine must return ok:false with
    // a structured RE_INTERNAL_CONFLICT failure, and the trace must show the Require as both
    // overridden AND a blocking conflict, naming both rules.
    // Reason: returning success silently drops a mandatory constraint — a downstream
    // consumer would believe the Require was honored when it was not.
    // Source: docs/spec/04_RULE_ENGINE_REVISED.md §3.3 step 5, §3.5.
    const high = withId(
      rule({
        priority: RulePriorityClass.PrintArea,
        domain: RuleDomain.Output,
        effect: { type: RuleEffectType.Forbid, targets: [crossPriorityTarget] },
      }),
      'a-high',
    );
    const low = withId(
      rule({
        priority: RulePriorityClass.SceneAesthetic,
        domain: RuleDomain.Output,
        effect: { type: RuleEffectType.Require, targets: [crossPriorityTarget] },
      }),
      'b-low',
    );
    const result = evaluateRules(input([low, high]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.map((failure) => failure.code)).toContain('RE_INTERNAL_CONFLICT');
      const requireEntry = result.trace.entries.find((entry) => entry.ruleId === low.id);
      expect(requireEntry?.overridden).toBe(true);
      expect(requireEntry?.overriddenBy).toBe(high.id);
      expect(requireEntry?.note).toBe('blocking_conflict_require_removed_by_higher_priority');
      expect(result.trace.droppedByPriority).toEqual([
        {
          ruleId: low.id,
          priority: low.priority,
          overriddenBy: high.id,
          reason: 'overridden_by_higher_priority',
        },
      ]);
    }
  });

  it('equal identical effects merge deterministically', () => {
    const a = withId(rule(), 'a');
    const b = withId(rule(), 'b');
    const result = evaluateRules(input([b, a]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.constraints[0]?.winningRuleIds).toEqual([a.id, b.id]);
  });

  it('equal forbid/require conflict blocks', () => {
    const forbid = withId(rule(), 'forbid');
    const require = withId(
      rule({ effect: { type: RuleEffectType.Require, targets: [target] } }),
      'require',
    );
    const result = evaluateRules(input([require, forbid]));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.failures.map((failure) => failure.code)).toContain('RE_INTERNAL_CONFLICT');
  });

  it('non-overlapping targets coexist', () => {
    const a = withId(rule(), 'a');
    const b = withId(
      rule({
        effect: {
          type: RuleEffectType.Forbid,
          targets: [{ kind: 'dimension', dimension: SceneDimension.Camera }],
        },
      }),
      'b',
    );
    const result = evaluateRules(input([a, b]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.constraints).toHaveLength(2);
  });

  it('lock and limit compose at equal priority', () => {
    const literalTarget = { kind: 'literal' as const, value: 'scene' };
    const lock = withId(
      rule({ effect: { type: RuleEffectType.Lock, targets: [literalTarget] } }),
      'lock',
    );
    const limit = withId(
      rule({
        effect: {
          type: RuleEffectType.Limit,
          targets: [literalTarget],
          limit: { kind: 'literal', value: 2 },
        },
      }),
      'limit',
    );
    const result = evaluateRules(input([limit, lock]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.constraints[0]?.lockedTo).toEqual(['scene']);
      expect(result.value.constraints[0]?.limit).toBe(2);
    }
  });

  it('lock and minimum limit both apply while a looser equal-priority limit is dropped', () => {
    const literalTarget = { kind: 'literal' as const, value: 'scene' };
    const lock = withId(
      rule({ effect: { type: RuleEffectType.Lock, targets: [literalTarget] } }),
      'a-lock',
    );
    const strict = withId(
      rule({
        effect: {
          type: RuleEffectType.Limit,
          targets: [literalTarget],
          limit: { kind: 'literal', value: 2 },
        },
      }),
      'b-strict',
    );
    const loose = withId(
      rule({
        effect: {
          type: RuleEffectType.Limit,
          targets: [literalTarget],
          limit: { kind: 'literal', value: 5 },
        },
      }),
      'c-loose',
    );
    const result = evaluateRules(input([loose, lock, strict]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.constraints[0]).toMatchObject({ lockedTo: ['scene'], limit: 2 });
      const entries = Object.fromEntries(
        result.value.trace.entries.map((entry) => [entry.ruleId, entry]),
      );
      expect(entries[lock.id]?.applied).toBe(true);
      expect(entries[strict.id]?.applied).toBe(true);
      expect(entries[loose.id]).toMatchObject({
        applied: false,
        overridden: true,
        overriddenBy: strict.id,
      });
    }
  });

  it('equal-priority lock/require incompatibility fails closed and remains explainable', () => {
    const target = { kind: 'literal' as const, value: 'white' };
    const lock = withId(
      rule({ effect: { type: RuleEffectType.Lock, targets: [target] } }),
      'lock-white',
    );
    const require = withId(
      rule({ effect: { type: RuleEffectType.Require, targets: [target] } }),
      'require-white',
    );
    const result = evaluateRules(input([lock, require]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.constraints[0]?.winningRuleIds).toEqual([lock.id, require.id]);
    }
  });

  it('disjoint domains never conflict even with the same literal target', () => {
    const composition = withId(
      rule({
        effect: { type: RuleEffectType.Forbid, targets: [{ kind: 'literal', value: 'opaque-id' }] },
      }),
      'composition',
    );
    const decor = withId(
      rule({
        priority: RulePriorityClass.Season,
        domain: RuleDomain.Decor,
        effect: {
          type: RuleEffectType.Require,
          targets: [{ kind: 'literal', value: 'opaque-id' }],
        },
      }),
      'decor',
    );
    const result = evaluateRules(input([composition, decor]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.constraints).toHaveLength(2);
  });

  it('CORRECTIVE #2 v2: two Lock rules sharing one literal value cluster into the same bucket and intersect (overlap-based bucketing, not exact-array)', () => {
    // Whole-array bucket keying (v1 of this fix) broke this: two Locks resolving to different
    // arrays never shared a bucket at all, so intersection never ran. Overlap-based clustering
    // (v2) fixes it: any shared value transitively clusters the rules into one bucket.
    const ctx: EvaluationContext = {
      ...context(),
      session: {
        ...context().session,
        colorSelection: { colorIds: [id<ColorId>('black'), id<ColorId>('white')], locked: true },
      },
    };
    const lockWhiteBlack = withId(
      rule({
        priority: RulePriorityClass.PaletteLock,
        domain: RuleDomain.GarmentColor,
        effect: {
          type: RuleEffectType.Lock,
          targets: [
            { kind: 'literal', value: 'white' },
            { kind: 'literal', value: 'black' },
          ],
        },
      }),
      'lock-white-black',
    );
    // A second, equal-priority Lock naming a DIFFERENT (overlapping-by-one) set.
    const lockBlackNavy = withId(
      rule({
        priority: RulePriorityClass.PaletteLock,
        domain: RuleDomain.GarmentColor,
        effect: { type: RuleEffectType.Lock, targets: [{ kind: 'literal', value: 'black' }] },
      }),
      'lock-black-navy',
    );
    const result = evaluateRules(input([lockWhiteBlack, lockBlackNavy], ctx));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const lockedTargets = result.value.constraints.filter((c) => c.lockedTo !== null);
      // 'white' (only in lockWhiteBlack) stays its own bucket / unaffected; 'black' is shared and
      // intersects to just ['black'] once both Locks are clustered together.
      const blackBucket = lockedTargets.find((c) => c.lockedTo?.includes('black'));
      expect(blackBucket?.lockedTo).toEqual(['black']);
    }
  });

  it('CORRECTIVE #2 v2: three same-priority Locks chained by pairwise overlap intersect to empty and block', () => {
    // A={x,y}, B={y,z}, C={z,w}: every adjacent pair overlaps (so all three transitively cluster
    // into one bucket under the overlap-clustering rule), but the full intersection A∩B∩C is
    // empty — a genuinely reachable "Lock combination excludes everything" blocking scenario that
    // requires overlap-based (not exact-array) bucketing to even be detected as one bucket.
    const domain = RuleDomain.Model;
    const priority = RulePriorityClass.AudienceSafety;
    const lockA = withId(
      rule({
        priority,
        domain,
        effect: {
          type: RuleEffectType.Lock,
          targets: [
            { kind: 'literal', value: 'pose_x' },
            { kind: 'literal', value: 'pose_y' },
          ],
        },
      }),
      'lock-a',
    );
    const lockB = withId(
      rule({
        priority,
        domain,
        effect: {
          type: RuleEffectType.Lock,
          targets: [
            { kind: 'literal', value: 'pose_y' },
            { kind: 'literal', value: 'pose_z' },
          ],
        },
      }),
      'lock-b',
    );
    const lockC = withId(
      rule({
        priority,
        domain,
        effect: {
          type: RuleEffectType.Lock,
          targets: [
            { kind: 'literal', value: 'pose_z' },
            { kind: 'literal', value: 'pose_w' },
          ],
        },
      }),
      'lock-c',
    );
    const result = evaluateRules(input([lockA, lockB, lockC]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.map((failure) => failure.code)).toContain('RE_INTERNAL_CONFLICT');
    }
  });

  it('logical input reordering produces byte-identical output', () => {
    const a = withId(rule(), 'a');
    const b = withId(
      rule({
        effect: {
          type: RuleEffectType.Forbid,
          targets: [{ kind: 'dimension', dimension: SceneDimension.Camera }],
        },
      }),
      'b',
    );
    const first = evaluateRules(input([a, b]));
    const second = evaluateRules(input([b, a]));
    expect(stableJson(first)).toBe(stableJson(second));
  });

  it('higher priority Forbid still simply overrides a lower priority Forbid on the same target (non-blocking case preserved)', () => {
    const high = withId(
      rule({
        priority: RulePriorityClass.PrintArea,
        domain: RuleDomain.Output,
        effect: { type: RuleEffectType.Forbid, targets: [crossPriorityTarget] },
      }),
      'a-high',
    );
    const low = withId(
      rule({
        priority: RulePriorityClass.SceneAesthetic,
        domain: RuleDomain.Output,
        effect: { type: RuleEffectType.Forbid, targets: [crossPriorityTarget] },
      }),
      'b-low',
    );
    const result = evaluateRules(input([low, high]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.constraints[0]?.forbidden).toBe(true);
      expect(result.value.trace.droppedByPriority).toEqual([
        {
          ruleId: low.id,
          priority: low.priority,
          overriddenBy: high.id,
          reason: 'overridden_by_higher_priority',
        },
      ]);
    }
  });

  it('CORRECTIVE #2: a ContextRef target and a Literal target that resolve to the same value conflict (were previously bucketed separately)', () => {
    // OLD (incorrect) expectation: bucketing keyed on the unresolved RuleTarget expression
    // (`literal:black` vs `contextRef:session.colorSelection.colorIds`), so a Forbid via
    // Literal and a Require via ContextRef resolving to the identical value never landed in
    // the same bucket and never conflicted — result.ok === true with two separate constraints.
    // NEW (correct) expectation: 04_RULE_ENGINE_REVISED §3.1/§3.3 — buckets are keyed by
    // (domain, RESOLVED target), so both rules land in one bucket and conflict as same-priority
    // Forbid vs Require ⇒ blocking (§3.5 table).
    // Source: docs/spec/04_RULE_ENGINE_REVISED.md §3.1, §3.3 step 2.
    const literalTarget = { kind: 'literal' as const, value: 'black' };
    const contextRefTarget = {
      kind: 'contextRef' as const,
      ref: { ref: id<ContextFieldPath>('session.colorSelection.colorIds') },
    };
    const ctx: EvaluationContext = {
      ...context(),
      session: {
        ...context().session,
        colorSelection: { colorIds: [id<ColorId>('black')], locked: true },
      },
    };
    // GarmentColor domain is only authorized for PaletteLock priority
    // (Corrective #3 / spec "garment-color domain only" governed by the
    // Palette Lock class) — both rules must use it, or validateDomainIsolation
    // rejects them with RULE_CFG_003 before bucketing ever runs. (This was
    // itself the root cause of the RULE_CFG_003 regression reported against
    // the first corrective release: these two tests used the default
    // SceneAesthetic priority, which is not authorized for GarmentColor.)
    const forbidByLiteral = withId(
      rule({
        priority: RulePriorityClass.PaletteLock,
        domain: RuleDomain.GarmentColor,
        effect: { type: RuleEffectType.Forbid, targets: [literalTarget] },
      }),
      'forbid-literal',
    );
    const requireByContextRef = withId(
      rule({
        priority: RulePriorityClass.PaletteLock,
        domain: RuleDomain.GarmentColor,
        effect: { type: RuleEffectType.Require, targets: [contextRefTarget] },
      }),
      'require-context-ref',
    );
    const result = evaluateRules(input([forbidByLiteral, requireByContextRef], ctx));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.map((failure) => failure.code)).toContain('RE_INTERNAL_CONFLICT');
    }
  });

  it('CORRECTIVE #2: distinct resolved values still land in different buckets and coexist', () => {
    const literalTarget = { kind: 'literal' as const, value: 'black' };
    const otherLiteralTarget = { kind: 'literal' as const, value: 'navy' };
    const a = withId(
      rule({
        priority: RulePriorityClass.PaletteLock,
        domain: RuleDomain.GarmentColor,
        effect: { type: RuleEffectType.Forbid, targets: [literalTarget] },
      }),
      'a',
    );
    const b = withId(
      rule({
        priority: RulePriorityClass.PaletteLock,
        domain: RuleDomain.GarmentColor,
        effect: { type: RuleEffectType.Require, targets: [otherLiteralTarget] },
      }),
      'b',
    );
    const result = evaluateRules(input([a, b]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.constraints).toHaveLength(2);
  });
});
