import { describe, expect, it } from 'vitest';
import {
  RuleEffectType,
  type ConditionNode,
  type Rule,
  type RuleId,
} from '../../src/shared/domain-model';
import { APP_CONFIG } from '../../src/config/app-config';
import { evaluateRules, ruleEngine, sha256Hex, stableJson } from '../../src/engines/rule-engine';
import { context, id, input, rule, ruleSet } from './fixtures';

describe('Rule Engine safety limits', () => {
  it('rejects excessively deep condition groups without stack overflow', () => {
    let condition: ConditionNode = rule().condition;
    for (let i = 0; i < 12; i += 1) condition = { all: [condition] };
    const r = rule({ condition });
    const result = evaluateRules(input([r]), {
      ...APP_CONFIG.limits.ruleEngine,
      maxConditionDepth: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.failures.some((failure) => failure.code === 'RE_INTERNAL_LIMIT')).toBe(true);
  });

  it('rejects cyclic runtime input', () => {
    const ctx = context() as unknown as Record<string, unknown>;
    ctx.self = ctx;
    const result = evaluateRules(input([rule()], ctx as never));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe('RE_INTERNAL_CYCLE');
  });

  it('rejects excessive rule count and target count', () => {
    const rules = Array.from({ length: 4 }, (_, index) => rule({ id: id<RuleId>(`r-${index}`) }));
    const tooManyRules = evaluateRules(input(rules), {
      ...APP_CONFIG.limits.ruleEngine,
      maxRules: 3,
    });
    expect(tooManyRules.ok).toBe(false);
    const manyTargets = rule({
      effect: {
        type: RuleEffectType.Forbid,
        targets: Array.from({ length: 4 }, (_, index) => ({
          kind: 'literal' as const,
          value: `x-${index}`,
        })),
      },
    });
    const tooManyTargets = evaluateRules(input([manyTargets]), {
      ...APP_CONFIG.limits.ruleEngine,
      maxTargetsPerRule: 3,
    });
    expect(tooManyTargets.ok).toBe(false);
  });

  it('handles 500 deterministic rules within a bounded normal test run', () => {
    const rules: Rule[] = Array.from({ length: 500 }, (_, index) =>
      rule({
        id: id<RuleId>(`stress-${String(index).padStart(4, '0')}`),
        effect: {
          type: RuleEffectType.Forbid,
          targets: [{ kind: 'literal', value: `opaque-${String(index).padStart(4, '0')}` }],
        },
      }),
    );
    const start = performance.now();
    const result = evaluateRules(input(rules));
    expect(result.ok).toBe(true);
    expect(performance.now() - start).toBeLessThan(2_000);
    if (result.ok) expect(result.value.constraints).toHaveLength(500);
  });

  it('does not evaluate code embedded in paths or targets', () => {
    (globalThis as Record<string, unknown>).ruleEnginePwned = false;
    const malicious = rule({
      effect: {
        type: RuleEffectType.Forbid,
        targets: [{ kind: 'literal', value: ');globalThis.ruleEnginePwned=true;//' }],
      },
    });
    evaluateRules(input([malicious]));
    expect((globalThis as Record<string, unknown>).ruleEnginePwned).toBe(false);
    delete (globalThis as Record<string, unknown>).ruleEnginePwned;
  });
});

describe('deterministic primitives and public contract', () => {
  it('SHA-256 matches a standard vector', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('canonical JSON ignores object insertion order but not array order', () => {
    expect(stableJson({ b: 2, a: 1 })).toBe(stableJson({ a: 1, b: 2 }));
    expect(stableJson([1, 2])).not.toBe(stableJson([2, 1]));
  });

  it('public RuleEngineContract adapter uses explicit Rule and RuleSet inputs', () => {
    const rules = [rule()];
    const result = ruleEngine.evaluate(
      context(),
      [ruleSet(rules)],
      rules,
      input(rules).evaluatedAt,
    );
    expect(result.ok).toBe(true);
  });

  it('double run produces byte-identical result', () => {
    const data = input([rule()]);
    expect(stableJson(evaluateRules(data))).toBe(stableJson(evaluateRules(data)));
  });
});
