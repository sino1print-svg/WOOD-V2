import type { EvaluationContext, NumericExpression } from '../../shared/domain-model';
import { failureFromCode } from './failures';
import { resolveContextPath } from './context';
import type { ResolutionResult, RuleEngineSafetyLimits } from './types';

export function evaluateNumericExpression(
  expression: NumericExpression,
  context: EvaluationContext,
  limits: RuleEngineSafetyLimits,
  depth = 0,
): ResolutionResult<number> {
  if (depth > limits.maxNumericExpressionDepth) {
    return { ok: false, failure: failureFromCode('RE_INTERNAL_LIMIT', 'effect.limit', null) };
  }
  let value: number;
  if (expression.kind === 'literal') {
    value = expression.value;
  } else if (expression.kind === 'contextRef') {
    const resolution = resolveContextPath(context, expression.ref.ref, limits);
    if (!resolution.ok) return resolution;
    if (!resolution.value.present || typeof resolution.value.value !== 'number') {
      return { ok: false, failure: failureFromCode('RULE_CFG_002', expression.ref.ref, null) };
    }
    value = resolution.value.value;
  } else if (expression.kind === 'binary') {
    const left = evaluateNumericExpression(expression.left, context, limits, depth + 1);
    if (!left.ok) return left;
    const right = evaluateNumericExpression(expression.right, context, limits, depth + 1);
    if (!right.ok) return right;
    if (expression.op === '+') value = left.value + right.value;
    else if (expression.op === '-') value = left.value - right.value;
    else if (expression.op === '*') value = left.value * right.value;
    else {
      if (right.value === 0) {
        return { ok: false, failure: failureFromCode('RULE_CFG_001', 'effect.limit', null) };
      }
      value = left.value / right.value;
    }
  } else {
    const values: number[] = [];
    for (const arg of expression.args) {
      const result = evaluateNumericExpression(arg, context, limits, depth + 1);
      if (!result.ok) return result;
      values.push(result.value);
    }
    if ((expression.fn === 'minimum' || expression.fn === 'maximum') && values.length === 0) {
      return { ok: false, failure: failureFromCode('RULE_CFG_001', 'effect.limit', null) };
    }
    if ((expression.fn === 'floor' || expression.fn === 'ceil') && values.length !== 1) {
      return { ok: false, failure: failureFromCode('RULE_CFG_001', 'effect.limit', null) };
    }
    if (expression.fn === 'minimum') value = Math.min(...values);
    else if (expression.fn === 'maximum') value = Math.max(...values);
    else if (expression.fn === 'floor') value = Math.floor(values[0]!);
    else value = Math.ceil(values[0]!);
  }
  return Number.isFinite(value)
    ? { ok: true, value }
    : { ok: false, failure: failureFromCode('RULE_CFG_001', 'effect.limit', null) };
}
