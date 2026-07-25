import { describe, expect, it } from 'vitest';
import {
  RuleDomain,
  RuleEffectType,
  RulePriorityClass,
  type ColorId,
  type EvaluationContext,
  type Rule,
  type RuleId,
} from '../../src/shared/domain-model';
import { evaluateRules, stableJson } from '../../src/engines/rule-engine';
import { context, id, input, rule } from './fixtures';

function lock(ruleId: string, values: readonly string[]): Rule {
  return rule({
    id: id<RuleId>(ruleId),
    priority: RulePriorityClass.PaletteLock,
    domain: RuleDomain.GarmentColor,
    effect: {
      type: RuleEffectType.Lock,
      targets: values.map((value) => ({ kind: 'literal' as const, value })),
    },
  });
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) =>
    permutations(items.filter((_, candidate) => candidate !== index)).map((rest) => [
      item,
      ...rest,
    ]),
  );
}

describe('Phase 2 corrective v3 n-way Lock intersection', () => {
  it('intersects two overlapping sets', () => {
    const result = evaluateRules(
      input([lock('a', ['white', 'black']), lock('b', ['black', 'navy'])]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.constraints[0]?.lockedTo).toEqual(['black']);
  });

  it('blocks a three-set empty total intersection despite transitive pairwise overlap', () => {
    const rules = [
      lock('a', ['white', 'black']),
      lock('b', ['black', 'navy']),
      lock('c', ['navy', 'red']),
    ];
    const result = evaluateRules(input(rules));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.some((failure) => failure.code === 'RE_INTERNAL_CONFLICT')).toBe(true);
      expect(result.failures.map((failure) => failure.message).join(' ')).toContain('a,b,c');
      expect(
        result.trace.entries.filter((entry) => ['a', 'b', 'c'].includes(String(entry.ruleId))),
      ).toHaveLength(3);
    }
  });

  it('returns the exact three-set non-empty total intersection', () => {
    const result = evaluateRules(
      input([
        lock('a', ['white', 'black', 'navy']),
        lock('b', ['black', 'navy']),
        lock('c', ['black', 'red']),
      ]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.constraints[0]?.lockedTo).toEqual(['black']);
  });

  it('deduplicates duplicate sets deterministically', () => {
    const result = evaluateRules(input([lock('a', ['black', 'black']), lock('b', ['black'])]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.constraints[0]?.lockedTo).toEqual(['black']);
  });

  it('blocks disjoint sets', () => {
    const result = evaluateRules(input([lock('a', ['white']), lock('b', ['black'])]));
    expect(result.ok).toBe(false);
  });

  it('intersects Literal and ContextRef sets', () => {
    const ctx: EvaluationContext = {
      ...context(),
      session: {
        ...context().session,
        colorSelection: {
          colorIds: [id<ColorId>('black'), id<ColorId>('navy')],
          locked: true,
        },
      },
    };
    const dynamic = rule({
      id: id<RuleId>('dynamic'),
      priority: RulePriorityClass.PaletteLock,
      domain: RuleDomain.GarmentColor,
      effect: {
        type: RuleEffectType.Lock,
        targets: [{ kind: 'contextRef', ref: { ref: id('session.colorSelection.colorIds') } }],
      },
    });
    const result = evaluateRules(input([lock('literal', ['black', 'white']), dynamic], ctx));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.constraints[0]?.lockedTo).toEqual(['black']);
  });

  it('produces byte-identical output for every input-order permutation', () => {
    const rules = [
      lock('a', ['white', 'black']),
      lock('b', ['black', 'navy']),
      lock('c', ['navy', 'red']),
    ];
    const outputs = permutations(rules).map((ordered) => stableJson(evaluateRules(input(ordered))));
    expect(new Set(outputs).size).toBe(1);
  });
});
