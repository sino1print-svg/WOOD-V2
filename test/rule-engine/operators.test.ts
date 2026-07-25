import { describe, expect, it } from 'vitest';
import {
  RuleOperator,
  type ConditionNode,
  type ContextFieldPath,
} from '../../src/shared/domain-model';
import { evaluateCondition, evaluateRules } from '../../src/engines/rule-engine';
import { APP_CONFIG } from '../../src/config/app-config';
import { context, id, input, rule } from './fixtures';

interface Case {
  readonly name: string;
  readonly field: string;
  readonly operator: RuleOperator;
  readonly yes: unknown;
  readonly no: unknown;
  readonly mismatch: unknown;
}

const cases: readonly Case[] = [
  {
    name: 'eq string',
    field: 'artwork.format',
    operator: RuleOperator.Equals,
    yes: 'png',
    no: 'jpg',
    mismatch: 1,
  },
  {
    name: 'neq boolean',
    field: 'output.isCollage',
    operator: RuleOperator.NotEquals,
    yes: true,
    no: false,
    mismatch: 'false',
  },
  {
    name: 'in',
    field: 'scene.view',
    operator: RuleOperator.In,
    yes: ['front', 'back'],
    no: ['side'],
    mismatch: 'front',
  },
  {
    name: 'not_in',
    field: 'scene.view',
    operator: RuleOperator.NotIn,
    yes: ['side'],
    no: ['front'],
    mismatch: 'side',
  },
  {
    name: 'includes scalar',
    field: 'scene.decorIds',
    operator: RuleOperator.Includes,
    yes: 'pumpkin',
    no: 'snow',
    mismatch: 3,
  },
  {
    name: 'excludes array',
    field: 'scene.decorIds',
    operator: RuleOperator.Excludes,
    yes: ['snow'],
    no: ['snow', 'candle'],
    mismatch: 3,
  },
  {
    name: 'count_eq',
    field: 'scene.decorIds',
    operator: RuleOperator.CountEquals,
    yes: 2,
    no: 1,
    mismatch: '2',
  },
  {
    name: 'count_gte',
    field: 'scene.decorIds',
    operator: RuleOperator.CountGte,
    yes: 2,
    no: 3,
    mismatch: '2',
  },
  {
    name: 'count_lte',
    field: 'scene.decorIds',
    operator: RuleOperator.CountLte,
    yes: 2,
    no: 1,
    mismatch: '2',
  },
  {
    name: 'num_eq',
    field: 'session.requestedSceneCount',
    operator: RuleOperator.NumberEquals,
    yes: 4,
    no: 3,
    mismatch: '4',
  },
  {
    name: 'num_gte',
    field: 'session.requestedSceneCount',
    operator: RuleOperator.NumberGte,
    yes: 4,
    no: 5,
    mismatch: '4',
  },
  {
    name: 'num_lte',
    field: 'session.requestedSceneCount',
    operator: RuleOperator.NumberLte,
    yes: 4,
    no: 3,
    mismatch: '4',
  },
  {
    name: 'num_gt',
    field: 'session.requestedSceneCount',
    operator: RuleOperator.NumberGt,
    yes: 3,
    no: 4,
    mismatch: '3',
  },
  {
    name: 'num_lt',
    field: 'session.requestedSceneCount',
    operator: RuleOperator.NumberLt,
    yes: 5,
    no: 4,
    mismatch: '5',
  },
];

function evaluate(field: string, operator: RuleOperator, value: unknown, ctx = context()) {
  return evaluateCondition(
    { field: id<ContextFieldPath>(field), operator, value } as ConditionNode,
    ctx,
    APP_CONFIG.limits.ruleEngine,
  );
}

describe.each(cases)('$name', ({ field, operator, yes, no, mismatch }) => {
  it('positive', () => expect(evaluate(field, operator, yes)).toEqual({ ok: true, value: true }));
  it('negative', () => expect(evaluate(field, operator, no)).toEqual({ ok: true, value: false }));
  it('type mismatch is structured', () => {
    const result = evaluate(field, operator, mismatch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('RULE_CFG_001');
  });
  it('missing field is distinct and structured', () => {
    const ctx = context() as unknown as Record<string, unknown>;
    const root = field.split('.')[0]!;
    delete ctx[root];
    const result = evaluate(field, operator, yes, ctx as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('RULE_CFG_002');
  });
  it('repeated evaluation is identical', () => {
    expect(evaluate(field, operator, yes)).toEqual(evaluate(field, operator, yes));
  });
});

describe('presence/null semantics', () => {
  it('Exists distinguishes null, false, zero and empty arrays', () => {
    expect(evaluate('outputB.artworkId', RuleOperator.Exists, null).ok).toBe(true);
    expect(evaluate('output.isCollage', RuleOperator.Exists, null)).toEqual({
      ok: true,
      value: true,
    });
    expect(evaluate('printArea.centeringOffset', RuleOperator.Exists, null)).toEqual({
      ok: true,
      value: true,
    });
    expect(evaluate('scene.propIds', RuleOperator.Exists, null)).toEqual({ ok: true, value: true });
  });
  it('IsNull is true for null and missing, false for false/zero/empty array', () => {
    const ctx = context();
    const nullCtx = { ...ctx, outputB: { ...ctx.outputB, artworkId: null } };
    expect(evaluate('outputB.artworkId', RuleOperator.IsNull, null, nullCtx)).toEqual({
      ok: true,
      value: true,
    });
    const missing = context() as unknown as { outputB: Record<string, unknown> };
    delete missing.outputB.artworkId;
    expect(evaluate('outputB.artworkId', RuleOperator.IsNull, null, missing as never)).toEqual({
      ok: true,
      value: true,
    });
    expect(evaluate('output.isCollage', RuleOperator.IsNull, null)).toEqual({
      ok: true,
      value: false,
    });
  });
  it('nested all/any/not uses specified empty identities and nesting', () => {
    const node: ConditionNode = {
      all: [{ any: [] }, { not: { all: [] } }],
    };
    expect(evaluateCondition(node, context(), APP_CONFIG.limits.ruleEngine)).toEqual({
      ok: true,
      value: false,
    });
  });
});

describe('non-finite scalar safety', () => {
  it('rejects non-finite equality operands as invalid configuration', () => {
    const ctx = context();
    const invalid = {
      ...ctx,
      printArea: { ...ctx.printArea, sizeRatio: Number.POSITIVE_INFINITY },
    };
    const r = rule({
      condition: {
        field: id<ContextFieldPath>('printArea.sizeRatio'),
        operator: RuleOperator.Equals,
        value: 0.4,
      },
    });
    const result = evaluateRules(input([r], invalid));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe('RULE_CFG_001');
  });
});
