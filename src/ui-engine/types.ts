import type { EngineResult } from '../shared/contracts';
import type {
  Audience,
  ColorId,
  DisplayMethod,
  GarmentView,
  ProductId,
  Scene,
  SeasonId,
  ValidationFailure,
} from '../shared/domain-model';

export type UiMode = 'quick' | 'advanced' | 'professional';
export type UiStep =
  | 'session'
  | 'season'
  | 'products'
  | 'colors'
  | 'audience'
  | 'count'
  | 'groups'
  | 'rules'
  | 'validation'
  | 'planning'
  | 'generation'
  | 'review';
export type UiPhase =
  | 'idle'
  | 'editing'
  | 'validating'
  | 'invalid'
  | 'ready'
  | 'generating-scenes'
  | 'scenes-ready'
  | 'generating-prompts'
  | 'prompts-ready'
  | 'save-pending'
  | 'saved'
  | 'failure';

export interface ProductDraft {
  readonly productId: ProductId;
  readonly quantity: number;
  readonly selectedViews: readonly GarmentView[];
  readonly displayMethods: readonly DisplayMethod[];
}

export interface SessionDraft {
  readonly title: string;
  readonly mode: UiMode;
  readonly seasonId: SeasonId | null;
  readonly audience: Audience | null;
  readonly countMode: 'fixed' | 'flexible';
  readonly targetCount: number;
  readonly products: readonly ProductDraft[];
  readonly colorIds: readonly ColorId[];
  readonly placement: 'center_chest' | 'full_front' | 'left_chest' | 'center_back';
  readonly customSceneDescription: string;
  readonly groupBy: 'product' | 'color' | 'view';
  readonly includeOutputB: boolean;
}

export interface PromptViewModel {
  readonly id: string;
  readonly sceneId: string;
  readonly kind: 'A' | 'B';
  readonly sourceOutputAId: string | null;
  readonly sourceHash: string | null;
  readonly sourceContentHash: string | null;
  readonly artworkId: string | null;
  readonly promptText: string;
  readonly promptHash: string;
  readonly productId: string;
  readonly colorId: string;
  readonly view: string;
  readonly placement: string;
  readonly printAreaProfileId: string;
}

export interface UiFailure {
  readonly code: string;
  readonly field: string;
  readonly messageAr: string;
  readonly severity: 'blocking' | 'warning';
  readonly source: 'ui' | 'engine' | 'persistence' | 'clipboard';
}

export interface UiState {
  readonly schemaVersion: 1;
  readonly phase: UiPhase;
  readonly step: UiStep;
  readonly draft: SessionDraft;
  readonly validatedFingerprint: string | null;
  readonly generatedFingerprint: string | null;
  readonly scenes: readonly Scene[];
  readonly prompts: readonly PromptViewModel[];
  readonly failures: readonly UiFailure[];
  readonly selectedPromptId: string | null;
  readonly dirty: boolean;
  readonly persisted: boolean;
  readonly requestSequence: number;
  readonly activeRequestSequence: number | null;
}

export interface UiCatalogProduct {
  readonly id: ProductId;
  readonly nameAr: string;
  readonly allowedViews: readonly GarmentView[];
  readonly allowedDisplayMethods: readonly DisplayMethod[];
  readonly allowedAudiences: readonly Audience[];
  readonly allowedColorIds: readonly ColorId[];
}

export interface UiCatalog {
  readonly products: readonly UiCatalogProduct[];
  readonly colors: readonly {
    readonly id: ColorId;
    readonly nameAr: string;
    readonly hex: string;
  }[];
  readonly seasons: readonly { readonly id: SeasonId; readonly nameAr: string }[];
}

export interface ValidationPort {
  validate(draft: SessionDraft): EngineResult<true>;
}
export interface RulePort {
  evaluate(draft: SessionDraft): EngineResult<readonly unknown[]>;
}
export interface PalettePort {
  resolve(draft: SessionDraft): EngineResult<readonly ColorId[]>;
}
export interface PrintAreaPort {
  resolve(draft: SessionDraft): EngineResult<{ readonly profileId: string }>;
}

export interface ResolvedUiGenerationPlan {
  readonly draft: SessionDraft;
  readonly rules: readonly unknown[];
  readonly palette: readonly ColorId[];
  readonly printArea: { readonly profileId: string };
  readonly fingerprint: string;
  readonly canonicalTargetCount: number;
}

export interface ScenePort {
  generate(
    plan: ResolvedUiGenerationPlan,
  ): EngineResult<readonly Scene[]> | Promise<EngineResult<readonly Scene[]>>;
}
export interface PromptPort {
  generate(
    scenes: readonly Scene[],
    plan: ResolvedUiGenerationPlan,
  ): EngineResult<readonly PromptViewModel[]> | Promise<EngineResult<readonly PromptViewModel[]>>;
}
export interface UiEnginePorts {
  readonly validation: ValidationPort;
  readonly rule: RulePort;
  readonly palette: PalettePort;
  readonly printArea: PrintAreaPort;
  readonly scene: ScenePort;
  readonly prompt: PromptPort;
}

export interface PersistencePort {
  save(serialized: string): Promise<EngineResult<true>>;
  load(): Promise<EngineResult<string>>;
  clear(): Promise<EngineResult<true>>;
}
export interface ClipboardPort {
  writeText(text: string): Promise<void>;
}

export function engineFailuresToUi(failures: readonly ValidationFailure[]): readonly UiFailure[] {
  return failures.map((failure) => ({
    code: failure.code,
    field: failure.field,
    messageAr: failure.message,
    severity: failure.severity === 'blocking' ? 'blocking' : 'warning',
    source: 'engine',
  }));
}
