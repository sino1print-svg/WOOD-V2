import { describe, expect, it } from 'vitest';
import type { ContextFieldPath, NumericExpression } from '../../src/shared/domain-model';
import { APP_CONFIG } from '../../src/config/app-config';
import { evaluateNumericExpression } from '../../src/engines/rule-engine';
import { context, id } from './fixtures';

const literal = (value: number): NumericExpression => ({ kind: 'literal', value });
const ref = (path: string): NumericExpression => ({
  kind: 'contextRef',
  ref: { ref: id<ContextFieldPath>(path) },
});
const binary = (
  op: '+' | '-' | '*' | '/',
  left: NumericExpression,
  right: NumericExpression,
): NumericExpression => ({ kind: 'binary', op, left, right });

function run(expression: NumericExpression) {
  return evaluateNumericExpression(expression, context(), APP_CONFIG.limits.ruleEngine);
}

describe('NumericExpression', () => {
  it.each([
    ['literal', literal(7), 7],
    ['ContextRef', ref('session.requestedSceneCount'), 4],
    ['add', binary('+', literal(2), literal(3)), 5],
    ['subtract', binary('-', literal(5), literal(3)), 2],
    ['multiply', binary('*', literal(5), literal(3)), 15],
    ['divide', binary('/', literal(8), literal(2)), 4],
    ['minimum', { kind: 'function', fn: 'minimum', args: [literal(4), literal(2)] }, 2],
    ['maximum', { kind: 'function', fn: 'maximum', args: [literal(4), literal(2)] }, 4],
    ['floor', { kind: 'function', fn: 'floor', args: [literal(2.9)] }, 2],
    ['ceil', { kind: 'function', fn: 'ceil', args: [literal(2.1)] }, 3],
  ] as const)('%s', (_name, expression, expected) => {
    expect(run(expression as NumericExpression)).toEqual({ ok: true, value: expected });
  });

  it('supports nested deterministic arithmetic', () => {
    const expression = binary(
      '*',
      binary('+', ref('session.requestedSceneCount'), literal(1)),
      literal(2),
    );
    expect(run(expression)).toEqual({ ok: true, value: 10 });
    expect(run(expression)).toEqual(run(expression));
  });

  it('rejects divide by zero', () => {
    const result = run(binary('/', literal(1), literal(0)));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('RULE_CFG_001');
  });

  it('rejects non-finite literal and overflow', () => {
    for (const expression of [
      literal(Number.NaN),
      binary('*', literal(Number.MAX_VALUE), literal(2)),
    ]) {
      const result = run(expression);
      expect(result.ok).toBe(false);
    }
  });

  it('rejects nonnumeric and missing ContextRef', () => {
    for (const expression of [ref('artwork.format'), ref('session.missing')]) {
      const result = run(expression);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.code).toBe('RULE_CFG_002');
    }
  });

  it('rejects invalid function arity', () => {
    const invalid: NumericExpression[] = [
      { kind: 'function', fn: 'minimum', args: [] },
      { kind: 'function', fn: 'floor', args: [literal(1), literal(2)] },
    ];
    for (const expression of invalid) expect(run(expression).ok).toBe(false);
  });

  it('fails safely at configured depth without stack overflow', () => {
    let expression: NumericExpression = literal(1);
    for (let i = 0; i < 10; i += 1) expression = binary('+', expression, literal(1));
    const result = evaluateNumericExpression(expression, context(), {
      ...APP_CONFIG.limits.ruleEngine,
      maxNumericExpressionDepth: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('RE_INTERNAL_LIMIT');
  });
});
