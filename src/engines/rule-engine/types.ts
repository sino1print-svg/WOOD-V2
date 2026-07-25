import type {
  EvaluationContext,
  IsoTimestamp,
  Rule,
  RuleEvaluationOutput,
  RuleSet,
  RuleTrace,
  ValidationFailure,
} from '../../shared/domain-model';

export interface RuleEngineSafetyLimits {
  readonly maxConditionDepth: number;
  readonly maxNumericExpressionDepth: number;
  readonly maxRules: number;
  readonly maxTargetsPerRule: number;
  readonly maxContextPathLength: number;
}

export interface RuleEngineInput {
  readonly context: EvaluationContext;
  readonly activeRuleSets: readonly RuleSet[];
  readonly rules: readonly Rule[];
  /** Caller-supplied deterministic evaluation timestamp. The Rule Engine never reads a clock. */
  readonly evaluatedAt: IsoTimestamp;
}

export type RuleEngineResult =
  | {
      readonly ok: true;
      readonly value: RuleEvaluationOutput;
      readonly warnings: readonly ValidationFailure[];
    }
  | {
      readonly ok: false;
      readonly failures: readonly ValidationFailure[];
      readonly trace: RuleTrace;
    };

export type ResolutionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ValidationFailure };
