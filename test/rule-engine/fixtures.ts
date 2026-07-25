import {
  Audience,
  CameraAngle,
  CoverLayout,
  DisplayMethod,
  GarmentView,
  RuleDomain,
  RuleEffectType,
  RuleOperator,
  RulePriorityClass,
  SceneDimension,
  SymbolicTarget,
  type ArtworkId,
  type ColorId,
  type ContextFieldPath,
  type EvaluationContext,
  type OutputAId,
  type PoseId,
  type ProductId,
  type Rule,
  type RuleId,
  type RuleSet,
  type RuleSetId,
  type SchemaVersion,
  type SeasonId,
} from '../../src/shared/domain-model';

export const id = <T extends string>(value: string): T => value as T;

export function context(): EvaluationContext {
  return {
    session: {
      audience: Audience.Adult,
      season: id<SeasonId>('halloween'),
      productIds: [id<ProductId>('prod-1')],
      colorSelection: { colorIds: [id<ColorId>('white'), id<ColorId>('black')], locked: true },
      requestedSceneCount: 4,
    },
    scene: {
      productId: id<ProductId>('prod-1'),
      decorIds: ['pumpkin', 'candle'],
      propIds: [],
      poseId: id<PoseId>('pose-1'),
      cameraAngle: CameraAngle.Eye,
      compositionId: 'composition-1',
      displayMethod: DisplayMethod.OnModel,
      paletteColorId: id<ColorId>('white'),
      view: GarmentView.Front,
      modelType: 'adult_model',
      isDuplicate: false,
      garmentColorAllowed: true,
    },
    printArea: { overlaps: [], sizeRatio: 0.4, centeringOffset: 0, shadowCoverage: 0 },
    background: { hasReadableText: false },
    output: { isCollage: false, saleImageHasMarks: false },
    outputB: {
      sourceOutputAId: id<OutputAId>('output-a-1'),
      artworkId: id<ArtworkId>('artwork-1'),
      isStale: false,
    },
    artwork: { format: 'png', hasTransparency: true },
    generationProgress: { outputAGenerated: 4, totalScenes: 4, allOutputAReady: true },
    cover: {
      sourceRefKinds: ['outputA'],
      hasPreviewRefs: false,
      layout: CoverLayout.Grid2x2,
      mockupCount: 4,
      layoutMatchesCount: true,
    },
  };
}

export function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: id<RuleId>('rule-1'),
    priority: RulePriorityClass.SceneAesthetic,
    domain: RuleDomain.Composition,
    condition: {
      field: id<ContextFieldPath>('session.requestedSceneCount'),
      operator: RuleOperator.NumberGte,
      value: 1,
    },
    effect: {
      type: RuleEffectType.Forbid,
      targets: [{ kind: 'dimension', dimension: SceneDimension.Composition }],
    },
    description: 'Test rule.',
    ...overrides,
  };
}

export function ruleSet(rules: readonly Rule[], setId = 'rule-set-1'): RuleSet {
  return {
    id: id<RuleSetId>(setId),
    schemaVersion: 3 as SchemaVersion,
    name: setId,
    ruleIds: rules.map((item) => item.id),
  };
}

/** Fixed deterministic timestamp for reproducible test traces (Corrective #7). */
export const FIXED_EVALUATED_AT =
  '2026-01-01T00:00:00.000Z' as unknown as import('../../src/shared/domain-model').IsoTimestamp;

export function input(rules: readonly Rule[], ctx: EvaluationContext = context()) {
  return {
    context: ctx,
    activeRuleSets: [ruleSet(rules)],
    rules,
    evaluatedAt: FIXED_EVALUATED_AT,
  } as const;
}

export const targetForDomain = (domain: RuleDomain) => {
  switch (domain) {
    case RuleDomain.PrintArea:
      return { kind: 'dimension' as const, dimension: SceneDimension.PrintAreaRules };
    case RuleDomain.Background:
      return { kind: 'symbolic' as const, symbol: SymbolicTarget.ReadableBackground };
    case RuleDomain.Output:
      return { kind: 'symbolic' as const, symbol: SymbolicTarget.CollageOutput };
    case RuleDomain.Model:
      return { kind: 'literal' as const, value: 'adult_model' };
    case RuleDomain.Decor:
      return { kind: 'dimension' as const, dimension: SceneDimension.Decor };
    case RuleDomain.GarmentColor:
    case RuleDomain.Palette:
      return { kind: 'dimension' as const, dimension: SceneDimension.GarmentColor };
    case RuleDomain.Composition:
      return { kind: 'dimension' as const, dimension: SceneDimension.Composition };
    case RuleDomain.Cover:
      return { kind: 'symbolic' as const, symbol: SymbolicTarget.CoverBuild };
    case RuleDomain.Product:
      return { kind: 'dimension' as const, dimension: SceneDimension.Product };
    case RuleDomain.Validation:
    case RuleDomain.Session:
      return { kind: 'symbolic' as const, symbol: SymbolicTarget.Generation };
    case RuleDomain.Artwork:
      return { kind: 'symbolic' as const, symbol: SymbolicTarget.ArtworkUpload };
    case RuleDomain.Prompt:
      return { kind: 'literal' as const, value: 'prompt.rule' };
    case RuleDomain.Export:
      return { kind: 'literal' as const, value: 'export.rule' };
    case RuleDomain.Group:
      return { kind: 'literal' as const, value: 'group.rule' };
  }
};
