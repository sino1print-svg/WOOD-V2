/**
 * Runtime-only projections — 03_DATA_MODELS_FINAL §3.15–§3.16 and
 * 04_RULE_ENGINE_REVISED §15. These objects are never persisted or exported.
 */
import type {
  ArtworkId,
  ColorId,
  OutputAId,
  PoseId,
  ProductId,
  RuleId,
  RuleSetId,
  SeasonId,
} from './ids';
import type { IsoTimestamp, Sha256 } from './primitives';
import type {
  Audience,
  CameraAngle,
  CoverLayout,
  DisplayMethod,
  GarmentView,
  PrintAreaObstruction,
  RuleDomain,
  RuleEffectType,
  RulePriorityClass,
  ValidationSeverity,
} from './enums';
import type { ConditionNode, RuleTarget } from './rules';
import type { ValidationFailure } from './entities';

export interface EvaluationContext {
  readonly session: {
    readonly audience: Audience;
    readonly season: SeasonId;
    readonly productIds: readonly ProductId[];
    readonly colorSelection: { readonly colorIds: readonly ColorId[]; readonly locked: boolean };
    readonly requestedSceneCount: number;
  };
  readonly scene: {
    readonly productId: ProductId;
    readonly decorIds: readonly string[];
    readonly propIds: readonly string[];
    readonly poseId: PoseId;
    readonly cameraAngle: CameraAngle;
    readonly compositionId: string;
    readonly displayMethod: DisplayMethod;
    readonly paletteColorId: ColorId;
    readonly view: GarmentView;
    readonly modelType: 'adult_model' | 'teen_model' | 'child_model' | 'none';
    readonly isDuplicate: boolean;
    readonly garmentColorAllowed: boolean;
  };
  readonly printArea: {
    readonly overlaps: readonly PrintAreaObstruction[];
    readonly sizeRatio: number;
    readonly centeringOffset: number;
    readonly shadowCoverage: number;
  };
  readonly background: { readonly hasReadableText: boolean };
  readonly output: { readonly isCollage: boolean; readonly saleImageHasMarks: boolean };
  readonly outputB: {
    readonly sourceOutputAId: OutputAId | null;
    readonly artworkId: ArtworkId | null;
    readonly isStale: boolean;
  };
  readonly artwork: { readonly format: string; readonly hasTransparency: boolean };
  readonly generationProgress: {
    readonly outputAGenerated: number;
    readonly totalScenes: number;
    readonly allOutputAReady: boolean;
  };
  readonly cover: {
    readonly sourceRefKinds: readonly ('outputA' | 'outputB')[];
    readonly hasPreviewRefs: boolean;
    readonly layout: CoverLayout;
    readonly mockupCount: number;
    readonly layoutMatchesCount: boolean;
  };
}

export interface ResolvedCondition {
  readonly source: ConditionNode;
  readonly matched: boolean;
}

export interface ResolvedTarget {
  readonly source: RuleTarget;
  readonly resolved: readonly string[];
}

export interface ResolvedEffect {
  readonly type: RuleEffectType;
  readonly targets: readonly ResolvedTarget[];
  readonly limit: number | null;
}

export interface ResolvedRule {
  readonly ruleId: RuleId;
  readonly priority: RulePriorityClass;
  readonly domain: RuleDomain;
  readonly condition: ResolvedCondition;
  readonly effect: ResolvedEffect;
  readonly appliedResultCode: string | null;
}

/** Runtime-only resolved bucket. It is a constraint description, not Scene output. */
export interface ResolvedConstraint {
  readonly bucketKey: string;
  readonly domain: RuleDomain;
  readonly target: string;
  readonly forbidden: boolean;
  readonly lockedTo: readonly string[] | null;
  readonly limit: number | null;
  readonly required: boolean;
  readonly winningRuleIds: readonly RuleId[];
}

export interface RuleTraceEntry {
  readonly ruleId: RuleId;
  readonly ruleSetIds: readonly RuleSetId[];
  readonly priority: RulePriorityClass;
  readonly domain: RuleDomain;
  readonly condition: ConditionNode;
  readonly matched: boolean;
  readonly resolvedTargets: readonly string[];
  readonly resolvedLimit: number | null;
  readonly effectApplied: RuleEffectType | null;
  readonly applied: boolean;
  readonly overridden: boolean;
  readonly overriddenBy: RuleId | null;
  readonly resultCode: string | null;
  readonly diagnosticMessageAr: string;
  readonly diagnosticMessageEn: string;
  readonly severity: ValidationSeverity | null;
  readonly note: string;
}

export interface DroppedRule {
  readonly ruleId: RuleId;
  readonly priority: RulePriorityClass;
  readonly overriddenBy: RuleId;
  readonly reason: 'overridden_by_higher_priority' | 'lost_tiebreak';
}

export interface RuleTrace {
  readonly contextHash: Sha256;
  /** Exact caller-supplied timestamp; the Rule Engine never reads a clock. */
  readonly evaluatedAt: IsoTimestamp;
  readonly entries: readonly RuleTraceEntry[];
  readonly droppedByPriority: readonly DroppedRule[];
  readonly outcome: 'passed' | 'blocked';
  readonly failures: readonly ValidationFailure[];
}

export interface RuleEvaluationOutput {
  readonly resolvedRules: readonly ResolvedRule[];
  readonly constraints: readonly ResolvedConstraint[];
  readonly trace: RuleTrace;
}
