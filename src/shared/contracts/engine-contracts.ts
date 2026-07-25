/**
 * Engine contracts — declared inputs/outputs only (12_IMPLEMENTATION_GUIDE §4/§5).
 *
 * IMPORTANT: These are TYPE CONTRACTS ONLY. No engine implementation exists in
 * Phase 0. The contracts encode each engine's documented I/O so future phases can
 * implement against a stable boundary. The Orchestrator is the sole pipeline
 * driver (10_APP_WORKFLOW §2); engines never receive the UI layer.
 */
import type {
  ColorId,
  Color,
  CoverId,
  CoverLayout,
  ColorSelection,
  ControlledVocabularies,
  CoverMetadata,
  DedupSignature,
  EvaluationContext,
  IsoTimestamp,
  ExportFormat,
  ExportManifest,
  ExportScope,
  MainCover,
  OutputA,
  Product,
  ProductId,
  Project,
  PromptModule,
  PhotoshootSession,
  PrintAreaObstruction,
  Rule,
  ResolvedRule,
  RuleEvaluationOutput,
  RuleSet,
  RuleTrace,
  Scene,
  Season,
  SessionId,
  DisplayMethod,
  ValidationFailure,
  ValidationResult,
} from '../domain-model';

/** Standard engine result: a value or structured, blocking-aware failures. */
export type EngineResult<T> =
  | { readonly ok: true; readonly value: T; readonly warnings?: readonly ValidationFailure[] }
  | { readonly ok: false; readonly failures: readonly ValidationFailure[] };

/** Rule Engine (04_RULE_ENGINE_REVISED §3). Pure; calls nothing. */
export type RuleEngineResult =
  | {
      readonly ok: true;
      readonly value: RuleEvaluationOutput;
      readonly warnings?: readonly ValidationFailure[];
    }
  | {
      readonly ok: false;
      readonly failures: readonly ValidationFailure[];
      readonly trace: RuleTrace;
    };

export interface RuleEngineContract {
  evaluate(
    context: EvaluationContext,
    activeRuleSets: readonly RuleSet[],
    rules: readonly Rule[],
    evaluatedAt: IsoTimestamp,
  ): RuleEngineResult;
}

/** Palette Engine — resolves the garment-color domain (RE §6; WF stage 2). Leaf. */
export interface PaletteEngineContract {
  resolve(input: {
    readonly selection: ColorSelection;
    readonly library: {
      readonly colors: readonly import('../domain-model').Color[];
      readonly palettes: readonly import('../domain-model').Palette[];
    };
    readonly constraints: readonly import('../domain-model').ResolvedConstraint[];
    readonly requestedGarmentColorId?: ColorId;
  }): EngineResult<{
    readonly colorIds: readonly ColorId[];
    readonly locked: boolean;
    readonly garmentColorAllowed: boolean | null;
  }>;
}

/** Measured print-area facts (08 CE §16 / RE §7). */
export interface PrintAreaMeasurement {
  readonly overlaps: readonly PrintAreaObstruction[];
  readonly sizeRatio: number;
  readonly centeringOffset: number;
  readonly shadowCoverage: number;
}

/** Print-Area Engine — measures facts only (RE §7). Leaf. */
export interface PrintAreaEngineContract {
  measure(input: {
    readonly scene: Scene;
    readonly product: Product;
    readonly profile: Product['printAreaProfile'];
    readonly observation: PrintAreaMeasurement;
    readonly constraints?: readonly import('../domain-model').ResolvedConstraint[];
    readonly requestedPosition?: Product['printAreaProfile']['position'];
  }): EngineResult<{
    readonly productId: Product['id'];
    readonly profileId: Product['printAreaProfile']['id'];
    readonly position: Product['printAreaProfile']['position'];
    readonly measurement: PrintAreaMeasurement;
    readonly diagnostics: readonly {
      readonly code: string;
      readonly messageAr: string;
      readonly messageEn: string;
    }[];
  }>;
}

/** Dedup Engine — computes signatures / uniqueness (SE §8). Leaf. */
export interface DedupEngineContract {
  sign(scene: Scene): DedupSignature;
  isDuplicate(signatureHash: string, seen: readonly string[]): boolean;
}

/** Scene Engine — assembles scenes (05_SCENE_ENGINE §2). Calls Rule/Palette/Print-Area/Dedup. */
export interface SceneEngineContract {
  assemble(
    session: PhotoshootSession,
    resolved: readonly ResolvedRule[],
    libraries: ControlledVocabularies,
    products: readonly Product[],
  ): EngineResult<readonly Scene[]>;
}

/** Validation Engine — the blocking gate (RE §14). Judges; never mutates. */
export interface ValidationEngineContract {
  validate(session: PhotoshootSession): ValidationResult;
}

/** Prompt Engine — composes A/B/Group prompt text (06_PROMPT_ENGINE §2). Reads only. */
export interface PromptEngineContract {
  composeOutputA(scene: Scene): EngineResult<string>;
  composeOutputB(scene: Scene): EngineResult<string>;
}

/** Cover Engine — composes the Cover Prompt from Output A only (08_COVER_ENGINE §1). */
export interface CoverSourceImage {
  readonly output: OutputA;
  readonly productId: ProductId;
  readonly displayMethod: DisplayMethod;
  readonly sceneOrder: number;
}

export type CoverProductManifest = Readonly<Pick<Product, 'id' | 'name'>>;

export type CoverSeasonManifest = Readonly<Pick<Season, 'id' | 'name' | 'kind'>>;

export type CoverColorManifest = Readonly<Pick<Color, 'id' | 'name' | 'hex'>>;

export type CoverProjectManifest = Readonly<Pick<Project, 'id' | 'isDigitalProduct'>>;

export interface CoverEngineVersions {
  readonly templateVersion: string;
  readonly generatorVersion: string;
  readonly moduleVersion: string;
}

export interface CoverEngineInput {
  readonly coverId: CoverId;
  readonly sessionId: SessionId;
  readonly saleImages: readonly CoverSourceImage[];
  readonly metadata: CoverMetadata;
  readonly project: CoverProjectManifest;
  readonly products: readonly CoverProductManifest[];
  readonly season: CoverSeasonManifest;
  readonly lockedColors: readonly CoverColorManifest[];
  readonly promptModule: PromptModule;
  readonly allOutputAReady: boolean;
  readonly versions: CoverEngineVersions;
  readonly generatedAt: string;
  readonly requestedLayout?: CoverLayout;
  readonly backgroundPreference?: 'warm_neutral' | 'green';
  readonly sourceMutationRequested?: boolean;
  readonly cachedCover?: MainCover;
}

export interface CoverEngineContract {
  compose(input: CoverEngineInput): EngineResult<MainCover>;
}

/** Export Engine — read-only packaging (09_EXPORT_ENGINE §2). Mutates nothing. */
export interface ExportEngineContract {
  export(
    session: PhotoshootSession,
    scope: ExportScope,
    formats: readonly ExportFormat[],
  ): EngineResult<ExportManifest>;
}
