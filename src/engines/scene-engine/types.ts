/**
 * Scene Engine — types. Sources: docs/spec/05_SCENE_ENGINE.md §1, §3-4, §6-10, §14-19.
 * Declarative input/output contracts + internal planning types. No I/O, no randomness.
 */
import type {
  Audience,
  CameraAngle,
  ColorSelection,
  ControlledVocabularies,
  CoverMetadata,
  DedupLedger,
  DisplayMethod,
  Group,
  GroupBy,
  ProductId,
  Scene,
  SeasonId,
  SessionId,
  ValidationFailure,
  VocabularyId,
  VocabularyTerm,
} from '../../shared/domain-model';
import type {
  CameraId,
  CompositionId,
  DecorId,
  LightingId,
  LocationId,
  PoseId,
  PropId,
  SceneTemplateId,
  Sha256,
} from '../../shared/domain-model';
import type { Product, ResolvedConstraint } from '../../shared/domain-model';
import type { PrintAreaObservation } from '../print-area-engine';

// ----------------------------------------------------------------------------
// §4 — Library Item Contract (SceneLibraryItem extends VocabularyTerm)
// ----------------------------------------------------------------------------

export type ProductKindOrId = ProductId | string;

export interface SceneLibraryItem extends VocabularyTerm {
  readonly seasonCompatibility: readonly SeasonId[] | 'all';
  readonly audienceCompatibility: readonly Audience[] | 'all';
  readonly productCompatibility: readonly ProductKindOrId[] | 'all';
  readonly weight: number;
  readonly priority: number;
  readonly exclusions: readonly VocabularyId[];
  readonly requiredCompanions: readonly VocabularyId[];
}

/** A season-owned pool of scene base templates (§3, §5 Step S1). */
export interface SceneTemplateLibraryItem extends SceneLibraryItem {
  readonly templateId: VocabularyId;
}

/** Twelve-dimension season scene library (§3). Cross-cutting dims are shared vocabularies. */
export interface SceneLibrary {
  readonly templates: readonly SceneTemplateLibraryItem[];
  readonly locations: readonly SceneLibraryItem[];
  readonly lightings: readonly SceneLibraryItem[];
  readonly decors: readonly SceneLibraryItem[];
  readonly props: readonly SceneLibraryItem[];
  readonly cameras: readonly SceneLibraryItem[];
  readonly compositions: readonly SceneLibraryItem[];
  readonly poses: readonly SceneLibraryItem[];
}

/** Camera vocabulary items must carry the resolved angle (DM §2.2 CameraTerm). */
export interface SceneCameraLibraryItem extends SceneLibraryItem {
  readonly angle: CameraAngle;
}

// ----------------------------------------------------------------------------
// §1.4 — Inputs
// ----------------------------------------------------------------------------

export interface SceneEngineSessionSelections {
  readonly sessionId: SessionId;
  readonly season: SeasonId;
  readonly audience: Audience;
  readonly productIds: readonly ProductId[];
  readonly colorSelection: ColorSelection;
  readonly requestedSceneCount: number;
  readonly groupBy: GroupBy;
  readonly isDigitalProduct: boolean;
}

/**
 * Deterministic print-area evaluator injected by the caller. The Scene Engine never
 * measures pixels itself (§16.2); it delegates to the Print-Area Engine's pure
 * `measurePrintArea` leaf via an observation the caller supplies per candidate context.
 * The function itself must be a pure, deterministic function of its inputs.
 */
export type PrintAreaObserver = (context: {
  readonly product: Product;
  readonly displayMethod: string;
  readonly cameraAngle: CameraAngle;
  readonly compositionId: string;
  readonly locationId: string;
  readonly poseId: string;
  readonly propIds: readonly string[];
}) => PrintAreaObservation;

export interface SceneEngineInput {
  readonly session: SceneEngineSessionSelections;
  readonly constraints: readonly ResolvedConstraint[];
  readonly products: readonly Product[];
  readonly vocabularies: ControlledVocabularies;
  readonly library: SceneLibrary;
  readonly dedupLedger: DedupLedger;
  readonly observePrintArea: PrintAreaObserver;
  readonly artworkIdsByProduct?: ReadonlyMap<
    ProductId,
    import('../../shared/domain-model').ArtworkId
  >;
}

// ----------------------------------------------------------------------------
// §1.5 — Outputs
// ----------------------------------------------------------------------------

export interface SceneEnginePlan {
  readonly scenes: readonly Scene[];
  readonly sceneOrder: readonly Scene['id'][];
  readonly groups: readonly Group[];
  readonly coverMetadata: CoverMetadata;
  readonly generationProgress: {
    readonly totalScenes: number;
    readonly outputAGenerated: number;
    readonly outputBGenerated: number;
    readonly coverGenerated: boolean;
    readonly allOutputAReady: boolean;
  };
  readonly dedupLedger: DedupLedger;
  readonly events: readonly SceneEngineEvent[];
}

export type SceneEngineEvent =
  | {
      readonly type: 'SceneCreated';
      readonly sceneId: Scene['id'];
      readonly sceneFingerprint: string;
    }
  | {
      readonly type: 'SceneUpdated';
      readonly sceneId: Scene['id'];
      readonly sceneFingerprint: string;
    };

export type SceneEngineResult =
  | {
      readonly ok: true;
      readonly value: SceneEnginePlan;
      readonly warnings: readonly ValidationFailure[];
    }
  | { readonly ok: false; readonly failures: readonly ValidationFailure[] };

// ----------------------------------------------------------------------------
// §6 — Internal candidate space
// ----------------------------------------------------------------------------

/** Lookup from any (branded) vocabulary/dimension ID to its library item (§4). */
export type SceneItemIndex = ReadonlyMap<string, SceneLibraryItem>;

export interface SceneCandidate {
  readonly templateId: SceneTemplateId;
  readonly productId: ProductId;
  readonly locationId: LocationId;
  readonly lightingId: LightingId;
  readonly decorIds: readonly DecorId[];
  readonly propIds: readonly PropId[];
  readonly cameraId: CameraId;
  readonly cameraAngle: CameraAngle;
  readonly compositionId: CompositionId;
  readonly poseId: PoseId;
  readonly displayMethod: DisplayMethod;
  readonly dedupHash: Sha256;
}

export interface ScoredCandidate {
  readonly candidate: SceneCandidate;
  readonly score: number;
  readonly maxPriority: number;
  readonly breakdown: {
    readonly printAreaVisibility: number;
    readonly conversionValue: number;
    readonly commercialRealism: number;
    readonly sessionConsistency: number;
    readonly diversityContribution: number;
    readonly penalty: number;
  };
}

/** §9.2 — constant for the whole session; anchors cohesion. */
export interface MoodAnchor {
  readonly seasonMoodTags: readonly string[];
  readonly paletteColorIds: readonly string[];
  readonly productIds: readonly ProductId[];
  readonly dominantLightingId: VocabularyId | null;
}

/** §8.2 — per-scene diversity signature (planning-only, not persisted). */
export interface DiversitySignature {
  readonly poseFamily: string;
  readonly camera: string;
  readonly composition: string;
  readonly background: string;
  readonly decor: string;
  readonly product: string;
  readonly sceneMood: string;
  readonly overallFeel: string;
}

/** §8.2-8.3 — running coverage/usage counters used for DiversityContribution + Penalty. */
export interface DiversityLedger {
  readonly axisUsage: ReadonlyMap<string, ReadonlyMap<string, number>>;
  readonly softCaps: ReadonlyMap<string, number>;
}
