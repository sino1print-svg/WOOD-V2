/**
 * Rule cluster — 03_DATA_MODELS_FINAL §3.12 (integrates RE amendments A1–A4).
 * Declarative types only.
 */
import type { ContextFieldPath, SchemaVersion } from './primitives';
import type { RuleId, RuleSetId } from './ids';
import {
  RuleDomain,
  RuleEffectType,
  RuleOperator,
  RulePriorityClass,
  SceneDimension,
  SymbolicTarget,
} from './enums';

/** A dynamic reference into the read-only EvaluationContext. */
export interface ContextRef {
  readonly ref: ContextFieldPath;
}

/** A single leaf condition (value accepts boolean and null; A1/A2). */
export interface RuleCondition {
  field: ContextFieldPath;
  operator: RuleOperator;
  value: string | number | boolean | null | readonly string[];
}

/** Composable compound conditions — exactly one of all/any/not (A2). */
export type ConditionGroup =
  | { readonly all: readonly ConditionNode[] }
  | { readonly any: readonly ConditionNode[] }
  | { readonly not: ConditionNode };

export type ConditionNode = RuleCondition | ConditionGroup;

/** Extensible target discriminated union (A3/#3). */
export type RuleTarget =
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'contextRef'; readonly ref: ContextRef }
  | { readonly kind: 'dimension'; readonly dimension: SceneDimension }
  | { readonly kind: 'symbolic'; readonly symbol: SymbolicTarget };

/** Deterministic numeric expression model (A4/#4). No runtime implementation. */
export type NumericExpression =
  | { readonly kind: 'literal'; readonly value: number }
  | { readonly kind: 'contextRef'; readonly ref: ContextRef }
  | {
      readonly kind: 'binary';
      readonly op: '+' | '-' | '*' | '/';
      readonly left: NumericExpression;
      readonly right: NumericExpression;
    }
  | {
      readonly kind: 'function';
      readonly fn: 'minimum' | 'maximum' | 'floor' | 'ceil';
      readonly args: readonly NumericExpression[];
    };

export interface RuleEffect {
  type: RuleEffectType;
  targets: readonly RuleTarget[];
  limit?: NumericExpression;
}

export interface Rule {
  readonly id: RuleId;
  priority: RulePriorityClass;
  domain: RuleDomain;
  condition: ConditionNode;
  effect: RuleEffect;
  description?: string;
}

export interface RuleSet {
  readonly id: RuleSetId;
  readonly schemaVersion: SchemaVersion;
  name: string;
  ruleIds: readonly RuleId[];
}
