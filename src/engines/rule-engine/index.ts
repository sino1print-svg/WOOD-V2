/**
 * Deterministic Rule Engine — Phase 2 only.
 * Pure leaf module: no persistence, UI, network, filesystem, time, or randomness.
 * Sources: 04_RULE_ENGINE_REVISED §§1–15; 12_IMPLEMENTATION_GUIDE §12.
 */
export { evaluateRules } from './engine';
export { evaluateCondition } from './conditions';
export { resolveContextPath, AUTHORIZED_CONTEXT_PATHS } from './context';
export { evaluateNumericExpression } from './numeric';
export { stableJson, sha256Hex } from './stable';
export type {
  RuleEngineInput,
  RuleEngineResult,
  RuleEngineSafetyLimits,
  ResolutionResult,
} from './types';

import type { RuleEngineContract } from '../../shared/contracts';
import type { EvaluationContext, IsoTimestamp, Rule, RuleSet } from '../../shared/domain-model';
import { evaluateRules as evaluateRulesCore } from './engine';

/** Public contract adapter. Rule/RuleSet aggregates remain explicit and separate. */
export const ruleEngine: RuleEngineContract = Object.freeze({
  evaluate(
    context: EvaluationContext,
    activeRuleSets: readonly RuleSet[],
    rules: readonly Rule[],
    evaluatedAt: IsoTimestamp,
  ) {
    return evaluateRulesCore({ context, activeRuleSets, rules, evaluatedAt });
  },
});
