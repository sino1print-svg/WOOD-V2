import { describe, expect, it } from 'vitest';
import {
  RuleDomain,
  RuleEffectType,
  RuleOperator,
  RulePriorityClass,
  SceneDimension,
  type ContextFieldPath,
  type RuleId,
} from '../../src/shared/domain-model';
import { evaluateRules, stableJson } from '../../src/engines/rule-engine';
import { context, id, input, rule } from './fixtures';

describe('public Rule Engine integration', () => {
  it('RuleSet + rules + EvaluationContext resolves deterministic constraints and trace', () => {
    const palette = rule({
      id: id<RuleId>('palette-lock'),
      priority: RulePriorityClass.PaletteLock,
      domain: RuleDomain.GarmentColor,
      condition: {
        field: id<ContextFieldPath>('session.colorSelection.locked'),
        operator: RuleOperator.Equals,
        value: true,
      },
      effect: {
        type: RuleEffectType.Lock,
        targets: [
          {
            kind: 'contextRef',
            ref: { ref: id<ContextFieldPath>('session.colorSelection.colorIds') },
          },
        ],
      },
      description: 'RULE_PAL_001.',
    });
    const count = rule({
      id: id<RuleId>('scene-count'),
      effect: {
        type: RuleEffectType.Limit,
        targets: [{ kind: 'literal', value: 'scene' }],
        limit: {
          kind: 'contextRef',
          ref: { ref: id<ContextFieldPath>('session.requestedSceneCount') },
        },
      },
    });
    const result = evaluateRules(input([count, palette]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.constraints).toHaveLength(2);
      expect(
        result.value.constraints.find((item) => item.domain === RuleDomain.GarmentColor)?.lockedTo,
      ).toEqual(['black', 'white']);
      expect(result.value.constraints.find((item) => item.limit !== null)?.limit).toBe(4);
      expect(result.value.trace.outcome).toBe('passed');
      expect(stableJson(result)).toBe(stableJson(evaluateRules(input([palette, count]))));
    }
  });

  it('unknown rule ID in RuleSet fails closed', () => {
    const r = rule();
    const data = input([r]);
    const result = evaluateRules({
      ...data,
      activeRuleSets: [{ ...data.activeRuleSets[0]!, ruleIds: [id<RuleId>('missing')] }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.failures.some((failure) => failure.code === 'RULE_CFG_002')).toBe(true);
  });

  it('duplicate rule ID and duplicate RuleSet ID fail closed', () => {
    const a = rule({ id: id<RuleId>('same') });
    const b = rule({ id: id<RuleId>('same') });
    expect(evaluateRules(input([a, b])).ok).toBe(false);
    const data = input([a]);
    expect(
      evaluateRules({ ...data, activeRuleSets: [data.activeRuleSets[0]!, data.activeRuleSets[0]!] })
        .ok,
    ).toBe(false);
  });

  it('pre-flight emits authoritative failures for missing audience/season/colors/count', () => {
    const ctx = context();
    const invalid = {
      ...ctx,
      session: {
        ...ctx.session,
        audience: '' as never,
        season: '' as never,
        colorSelection: { colorIds: [], locked: true },
        requestedSceneCount: 0,
      },
    };
    const result = evaluateRules(input([rule()], invalid));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.map((failure) => failure.code).sort()).toEqual([
        'RULE_AUD_003',
        'RULE_CNT_002',
        'RULE_PAL_003',
        'RULE_SEA_005',
      ]);
    }
  });

  it('resolved runtime trace has no persistence API or storage side effect', () => {
    const result = evaluateRules(input([rule()]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.value.trace)).not.toContain('save');
      expect(stableJson(result.value.trace)).not.toContain('projectState');
    }
  });

  it('all four documented effects resolve without mutating inputs', () => {
    const originalContext = context();
    const snapshot = stableJson(originalContext);
    const effects = [
      rule({ id: id<RuleId>('forbid') }),
      rule({
        id: id<RuleId>('require'),
        effect: {
          type: RuleEffectType.Require,
          targets: [{ kind: 'dimension', dimension: SceneDimension.Camera }],
        },
      }),
      rule({
        id: id<RuleId>('lock'),
        effect: {
          type: RuleEffectType.Lock,
          targets: [{ kind: 'dimension', dimension: SceneDimension.Pose }],
        },
      }),
      rule({
        id: id<RuleId>('limit'),
        effect: {
          type: RuleEffectType.Limit,
          targets: [{ kind: 'literal', value: 'scene' }],
          limit: { kind: 'literal', value: 2 },
        },
      }),
    ];
    const result = evaluateRules(input(effects, originalContext));
    expect(result.ok).toBe(true);
    expect(stableJson(originalContext)).toBe(snapshot);
    expect(effects.map((item) => item.effect.type)).toEqual(['forbid', 'require', 'lock', 'limit']);
  });
});
