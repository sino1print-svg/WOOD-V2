import {
  RuleOperator,
  type ConditionNode,
  type EvaluationContext,
} from '../../shared/domain-model';
import { failureFromCode } from './failures';
import { resolveContextPath } from './context';
import type { ResolutionResult, RuleEngineSafetyLimits } from './types';

function scalarType(value: unknown): 'string' | 'number' | 'boolean' | 'null' | 'other' {
  if (value === null) return 'null';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'other';
}

function invalid(field: string): ResolutionResult<boolean> {
  return { ok: false, failure: failureFromCode('RULE_CFG_001', field, null) };
}

export function evaluateCondition(
  node: ConditionNode,
  context: EvaluationContext,
  limits: RuleEngineSafetyLimits,
  depth = 0,
): ResolutionResult<boolean> {
  if (depth > limits.maxConditionDepth) {
    return { ok: false, failure: failureFromCode('RE_INTERNAL_LIMIT', 'condition', null) };
  }
  if ('all' in node) {
    for (const child of node.all) {
      const result = evaluateCondition(child, context, limits, depth + 1);
      if (!result.ok) return result;
      if (!result.value) return { ok: true, value: false };
    }
    return { ok: true, value: true };
  }
  if ('any' in node) {
    for (const child of node.any) {
      const result = evaluateCondition(child, context, limits, depth + 1);
      if (!result.ok) return result;
      if (result.value) return { ok: true, value: true };
    }
    return { ok: true, value: false };
  }
  if ('not' in node) {
    const result = evaluateCondition(node.not, context, limits, depth + 1);
    return result.ok ? { ok: true, value: !result.value } : result;
  }

  const resolution = resolveContextPath(context, node.field, limits);
  if (!resolution.ok) return resolution;
  const { present, value: actual } = resolution.value;
  const expected = node.value;

  if (!present && node.operator !== RuleOperator.Exists && node.operator !== RuleOperator.IsNull) {
    return { ok: false, failure: failureFromCode('RULE_CFG_002', node.field, null) };
  }

  switch (node.operator) {
    case RuleOperator.Exists:
      return expected === null
        ? { ok: true, value: present && actual !== null }
        : invalid(node.field);
    case RuleOperator.IsNull:
      return expected === null
        ? { ok: true, value: !present || actual === null }
        : invalid(node.field);
    case RuleOperator.Equals:
    case RuleOperator.NotEquals: {
      if (!present || actual === null || expected === null || Array.isArray(expected)) {
        return invalid(node.field);
      }
      if (scalarType(actual) !== scalarType(expected) || scalarType(actual) === 'other') {
        return invalid(node.field);
      }
      if (
        (typeof actual === 'number' && !Number.isFinite(actual)) ||
        (typeof expected === 'number' && !Number.isFinite(expected))
      ) {
        return invalid(node.field);
      }
      const equal = actual === expected;
      return { ok: true, value: node.operator === RuleOperator.Equals ? equal : !equal };
    }
    case RuleOperator.In:
    case RuleOperator.NotIn: {
      if (!present || typeof actual !== 'string' || !Array.isArray(expected))
        return invalid(node.field);
      const included = expected.includes(actual);
      return { ok: true, value: node.operator === RuleOperator.In ? included : !included };
    }
    case RuleOperator.Includes:
    case RuleOperator.Excludes: {
      if (!present || !Array.isArray(actual)) return invalid(node.field);
      if (!actual.every((item) => typeof item === 'string')) return invalid(node.field);
      const requested = Array.isArray(expected) ? expected : [expected];
      if (!requested.every((item) => typeof item === 'string')) return invalid(node.field);
      const intersects = requested.some((item) => actual.includes(item));
      return {
        ok: true,
        value: node.operator === RuleOperator.Includes ? intersects : !intersects,
      };
    }
    case RuleOperator.CountEquals:
    case RuleOperator.CountGte:
    case RuleOperator.CountLte: {
      if (
        !present ||
        !Array.isArray(actual) ||
        typeof expected !== 'number' ||
        !Number.isFinite(expected)
      ) {
        return invalid(node.field);
      }
      if (node.operator === RuleOperator.CountEquals)
        return { ok: true, value: actual.length === expected };
      if (node.operator === RuleOperator.CountGte)
        return { ok: true, value: actual.length >= expected };
      return { ok: true, value: actual.length <= expected };
    }
    case RuleOperator.NumberEquals:
    case RuleOperator.NumberGte:
    case RuleOperator.NumberLte:
    case RuleOperator.NumberGt:
    case RuleOperator.NumberLt: {
      if (
        !present ||
        typeof actual !== 'number' ||
        !Number.isFinite(actual) ||
        typeof expected !== 'number' ||
        !Number.isFinite(expected)
      ) {
        return invalid(node.field);
      }
      if (node.operator === RuleOperator.NumberEquals)
        return { ok: true, value: actual === expected };
      if (node.operator === RuleOperator.NumberGte) return { ok: true, value: actual >= expected };
      if (node.operator === RuleOperator.NumberLte) return { ok: true, value: actual <= expected };
      if (node.operator === RuleOperator.NumberGt) return { ok: true, value: actual > expected };
      return { ok: true, value: actual < expected };
    }
    default:
      return invalid(node.field);
  }
}
