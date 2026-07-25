import { describe, expect, it } from 'vitest';
import {
  EngineId,
  RuleDomain,
  RuleEffectType,
  RuleOperator,
  RulePriorityClass,
  type ContextFieldPath,
  type RuleId,
} from '../../src/shared/domain-model';
import { ERROR_REGISTRY } from '../../src/shared/errors';
import { evaluateRules, stableJson } from '../../src/engines/rule-engine';
import { context, id, input, rule } from './fixtures';

describe('RuleTrace', () => {
  it('records matched, unmatched, applied and deterministic ordering', () => {
    const matched = rule({ id: id<RuleId>('b-matched'), description: 'RULE_DUP_001.' });
    const unmatched = rule({
      id: id<RuleId>('a-unmatched'),
      condition: {
        field: id<ContextFieldPath>('session.requestedSceneCount'),
        operator: RuleOperator.NumberLt,
        value: 1,
      },
    });
    const result = evaluateRules(input([matched, unmatched]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.trace.entries.map((entry) => entry.ruleId)).toEqual([
        unmatched.id,
        matched.id,
      ]);
      expect(result.value.trace.entries[0]).toMatchObject({ matched: false, applied: false });
      expect(result.value.trace.entries[1]).toMatchObject({
        matched: true,
        applied: true,
        resultCode: null,
      });
    }
  });

  it('description text, translations, codes, emptiness and omission have no semantic effect', () => {
    const variants = [
      'RULE_AUD_001',
      'RULE_AUD_001 RULE_PA_001 RULE_CFG_001',
      'وصف مترجم بالكامل',
      '',
      undefined,
    ];
    const outputs = variants.map((description) =>
      stableJson(evaluateRules(input([rule({ description })]))),
    );
    expect(new Set(outputs).size).toBe(1);
  });

  it('trace output is byte-identical for equal logical inputs', () => {
    const r = rule();
    const first = evaluateRules(input([r]));
    const reorderedContext = JSON.parse(stableJson(context())) as never;
    const second = evaluateRules(input([r], reorderedContext));
    expect(stableJson(first)).toBe(stableJson(second));
  });
});

describe('engine-owned RULE_ failures', () => {
  it('keeps authoritative engine ownership metadata in the registry', () => {
    const engineOwned = ERROR_REGISTRY.filter(
      (entry) => entry.namespace === 'RULE' && entry.originEngine === EngineId.Rule,
    );
    expect(engineOwned.length).toBeGreaterThan(0);
    expect(
      engineOwned.every((entry) => entry.messageAr.length > 0 && entry.messageEn.length > 0),
    ).toBe(true);
  });

  it('triggers RULE_CFG_001 for invalid operator shape', () => {
    const bad = rule({
      condition: {
        field: id<ContextFieldPath>('session.requestedSceneCount'),
        operator: 'made_up' as RuleOperator,
        value: 1,
      },
    });
    const result = evaluateRules(input([bad]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe('RULE_CFG_001');
  });

  it('triggers RULE_CFG_002 for unauthorized ContextRef', () => {
    const bad = rule({
      effect: {
        type: RuleEffectType.Lock,
        targets: [
          { kind: 'contextRef', ref: { ref: id<ContextFieldPath>('session.__proto__.polluted') } },
        ],
      },
    });
    const result = evaluateRules(input([bad]));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.failures.some((failure) => failure.code === 'RULE_CFG_002')).toBe(true);
  });

  it('triggers RULE_CFG_003 for Season to garment-color write', () => {
    const bad = rule({
      priority: RulePriorityClass.Season,
      domain: RuleDomain.GarmentColor,
      effect: { type: RuleEffectType.Lock, targets: [{ kind: 'literal', value: 'white' }] },
    });
    const result = evaluateRules(input([bad]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe('RULE_CFG_003');
  });
});
