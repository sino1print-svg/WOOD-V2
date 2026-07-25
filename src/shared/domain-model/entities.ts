/**
 * Domain entities — 03_DATA_MODELS_FINAL §3.1–§3.14, §3.17–§3.18.
 * Declarative types only. No logic.
 */
import type { ById, HexColor, IsoTimestamp, SchemaVersion, Sha256, SemVer } from './primitives';
import type {
  ArtworkId,
  AssetRef,
  ColorId,
  CoverId,
  GroupId,
  OutputAId,
  OutputBId,
  PaletteId,
  PrintAreaRuleSetId,
  ProductId,
  ProjectId,
  RuleId,
  SceneId,
  SceneTemplateId,
  SeasonId,
  SessionId,
  ValidationResultId,
  VersionId,
  VocabularyId,
  CameraId,
  CompositionId,
  DecorId,
  LightingId,
  LocationId,
  PoseId,
  PropId,
} from './ids';
import {
  Audience,
  CameraAngle,
  CoverLayout,
  DisplayMethod,
  EngineId,
  GarmentView,
  GroupBy,
  OutputStatus,
  PersistenceMode,
  PrintAreaObstruction,
  ProductKind,
  PromptModuleType,
  RetentionPolicyKind,
  RuleDomain,
  RulePriorityClass,
  SeasonKind,
  SessionStatus,
  ValidationCheck,
  ValidationSeverity,
} from './enums';
import type { ContextFieldPath } from './primitives';
import type { PromptModuleId, RuleSetId } from './ids';

// ----------------------------------------------------------------------------
// Project (§3.1)
// ----------------------------------------------------------------------------
export interface Project {
  readonly id: ProjectId;
  readonly schemaVersion: SchemaVersion;
  name: string;
  readonly createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  sessions: ById<SessionId, PhotoshootSession>;
  sessionOrder: readonly SessionId[];
  currentVersionId: VersionId | null;
  versionHistory: ById<VersionId, VersionSnapshot>;
  versionOrder: readonly VersionId[];
  isDigitalProduct: boolean;
  persistenceMode: PersistenceMode;
  ownerRef?: string;
  retention: RetentionPolicy;
  artworks: ById<ArtworkId, Artwork>;
}

// ----------------------------------------------------------------------------
// PhotoshootSession (§3.2)
// ----------------------------------------------------------------------------
export interface PhotoshootSession {
  readonly id: SessionId;
  readonly projectId: ProjectId;
  name: string;
  readonly createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  season: SeasonId;
  audience: Audience;
  productIds: readonly ProductId[];
  colorSelection: ColorSelection;
  requestedSceneCount: number;
  scenes: ById<SceneId, Scene>;
  sceneOrder: readonly SceneId[];
  groups: ById<GroupId, Group>;
  cover: MainCover | null;
  status: SessionStatus;
  validationResultId: ValidationResultId | null;
  validationResults: ById<ValidationResultId, ValidationResult>;
  dedupLedger: DedupLedger;
  generationProgress: GenerationProgress;
  fingerprint: SessionFingerprint;
}

export interface GenerationProgress {
  totalScenes: number;
  outputAGenerated: number;
  outputBGenerated: number;
  coverGenerated: boolean;
  allOutputAReady: boolean;
}

// ----------------------------------------------------------------------------
// Product (§3.3)
// ----------------------------------------------------------------------------
export interface Product {
  readonly id: ProductId;
  readonly schemaVersion: SchemaVersion;
  readonly kind: ProductKind;
  name: string;
  type: string;
  allowedViews: readonly GarmentView[];
  printAreaProfile: PrintAreaProfile;
  audienceConstraints: AudienceConstraints;
  defaultColors: readonly ColorId[];
  expandable: true;
  metadata?: Record<string, string>;
  productHash?: Sha256;
}

export interface AudienceConstraints {
  forbidAdultModels?: boolean;
  kidsOnly?: boolean;
  allowedAudiences?: readonly Audience[];
}

export interface PrintAreaProfile {
  readonly id: PrintAreaRuleSetId;
  position: 'center_chest' | 'full_front' | 'left_chest' | 'center_back';
  minSizeRatio: number;
  centeringTolerance: number;
  centered: boolean;
  maxShadowCoverage: number;
  forbiddenOverlaps: readonly PrintAreaObstruction[];
}

// ----------------------------------------------------------------------------
// Season (§3.4)
// ----------------------------------------------------------------------------
export interface Season {
  readonly id: SeasonId;
  readonly schemaVersion: SchemaVersion;
  readonly kind: SeasonKind;
  name: string;
  sceneLibraryRef: VocabularyId;
  decorConstraints: readonly RuleId[];
  heroSceneConstraints: readonly RuleId[];
  forbiddenSeasonDecor: readonly DecorId[];
}

// ----------------------------------------------------------------------------
// Scene (§3.5)
// ----------------------------------------------------------------------------
export interface Scene {
  readonly id: SceneId;
  readonly sessionId: SessionId;
  readonly templateId: SceneTemplateId;
  productId: ProductId;
  locationId: LocationId;
  lightingId: LightingId;
  decorIds: readonly DecorId[];
  propIds: readonly PropId[];
  cameraId: CameraId;
  compositionId: CompositionId;
  poseId: PoseId;
  displayMethod: DisplayMethod;
  paletteColorId: ColorId;
  seasonId: SeasonId;
  printAreaRulesRef: PrintAreaRuleSetId;
  view: GarmentView;
  dedupSignature: DedupSignature;
  outputA: OutputA;
  outputB: OutputB | null;
  sceneVersion: number;
  sceneHash: Sha256;
  sceneFingerprint: Sha256;
}

export interface DedupSignature {
  readonly sceneTemplateId: SceneTemplateId;
  readonly poseId: PoseId;
  readonly cameraAngle: CameraAngle;
  readonly compositionId: CompositionId;
  readonly hash: Sha256;
}

export interface DedupLedger {
  seen: readonly Sha256[];
  combinationSpaceSize: number;
}

// ----------------------------------------------------------------------------
// OutputA (§3.6)
// ----------------------------------------------------------------------------
export interface OutputA {
  readonly id: OutputAId;
  readonly sceneId: SceneId;
  garment: string;
  color: ColorId;
  view: GarmentView;
  status: OutputStatus;
  readonly forbidden: readonly ['artwork', 'logo', 'watermark', 'typography'];
  promptText: string;
  contentHash: Sha256;
  readonly generatedAt: IsoTimestamp | null;
  promptHash: Sha256;
  renderHash: Sha256 | null;
  promptMeta: PromptMetadata | null;
}

// ----------------------------------------------------------------------------
// OutputB (§3.7)
// ----------------------------------------------------------------------------
export interface OutputB {
  readonly id: OutputBId;
  readonly sceneId: SceneId;
  readonly sourceOutputAId: OutputAId;
  readonly artworkId: ArtworkId;
  readonly onlyArtworkChanges: true;
  sourceContentHash: Sha256;
  status: OutputStatus;
  promptText: string;
  readonly generatedAt: IsoTimestamp | null;
  promptHash: Sha256;
  renderHash: Sha256 | null;
  sourceHash: Sha256;
  contentHash: Sha256;
  promptMeta: PromptMetadata | null;
}

// ----------------------------------------------------------------------------
// Artwork (§3.8)
// ----------------------------------------------------------------------------
export interface Artwork {
  readonly id: ArtworkId;
  readonly projectId: ProjectId;
  fileName: string;
  pngAssetRef: AssetRef;
  readonly uploadedAt: IsoTimestamp;
  format: 'png';
  hasTransparency: boolean;
  widthPx: number;
  heightPx: number;
  dpi?: number;
  aspectRatio: number;
  contentHash: Sha256;
}

// ----------------------------------------------------------------------------
// MainCover (§3.9)
// ----------------------------------------------------------------------------
export interface MainCover {
  readonly id: CoverId;
  readonly sessionId: SessionId;
  readonly sourceSaleImageIds: readonly OutputAId[];
  layout: CoverLayout;
  readMetadata: CoverMetadata;
  status: OutputStatus;
  promptText: string;
  readonly generatedAt: IsoTimestamp | null;
  promptHash: Sha256;
  renderHash: Sha256 | null;
  coverHash: Sha256;
  promptMeta: PromptMetadata | null;
}

export interface CoverMetadata {
  productIds: readonly ProductId[];
  colors: readonly ColorId[];
  mockupCount: number;
  views: readonly GarmentView[];
  seasonId: SeasonId;
  digitalProductStatus: boolean;
  primaryProduct: ProductId;
  primaryColor: ColorId;
  primaryView: GarmentView;
  primaryAudience: Audience;
}

// ----------------------------------------------------------------------------
// Group (§3.10)
// ----------------------------------------------------------------------------
export interface Group {
  readonly id: GroupId;
  readonly sessionId: SessionId;
  groupBy: GroupBy;
  key: ProductId | ColorId | GarmentView;
  sceneIds: readonly SceneId[];
  groupPromptText: string | null;
  groupPromptMeta?: PromptMetadata | null;
}

// ----------------------------------------------------------------------------
// ColorSelection / Palette (§3.11)
// ----------------------------------------------------------------------------
export interface Color {
  readonly id: ColorId;
  name: string;
  hex: HexColor;
}

export interface Palette {
  readonly id: PaletteId;
  readonly schemaVersion: SchemaVersion;
  name: string;
  colorIds: readonly ColorId[];
  lockRules: readonly RuleId[];
}

export interface ColorSelection {
  colorIds: readonly ColorId[];
  locked: boolean;
  paletteId?: PaletteId;
}

// ----------------------------------------------------------------------------
// PromptModule (§10 PRD / DM §3.13-adjacent)
// ----------------------------------------------------------------------------
export interface PromptModule {
  readonly id: PromptModuleId;
  readonly schemaVersion: SchemaVersion;
  moduleType: PromptModuleType;
  template: string;
  variables: readonly string[];
  constraintsRef?: RuleSetId;
}

// ----------------------------------------------------------------------------
// ValidationResult (§3.13)
// ----------------------------------------------------------------------------
export interface ValidationResult {
  readonly id: ValidationResultId;
  readonly sessionId: SessionId;
  readonly evaluatedAt: IsoTimestamp;
  passed: boolean;
  checks: readonly ValidationCheckResult[];
  failures: readonly ValidationFailure[];
}

export interface ValidationCheckResult {
  check: ValidationCheck;
  passed: boolean;
}

export interface ValidationFailure {
  check: ValidationCheck;
  field: ContextFieldPath | string;
  code: string;
  message: string;
  severity: ValidationSeverity;
  ruleId: RuleId | null;
  priorityClass: RulePriorityClass | null;
  domain: RuleDomain | null;
  originEngine: EngineId;
}

// ----------------------------------------------------------------------------
// VersionSnapshot (§3.14)
// ----------------------------------------------------------------------------
export interface VersionSnapshot {
  readonly versionId: VersionId;
  readonly projectId: ProjectId;
  readonly timestamp: IsoTimestamp;
  readonly parentVersionId: VersionId | null;
  readonly projectState: SerializedProjectState;
  readonly reason: 'generated' | 'manual_save' | 'duplicate';
  readonly stateHash?: Sha256;
}

export type SerializedProjectState = string & { readonly __brand: 'SerializedProjectState' };

export interface RetentionPolicy {
  kind: RetentionPolicyKind;
  keepN?: number;
  keepDays?: number;
}

// ----------------------------------------------------------------------------
// PromptMetadata (§3.17)
// ----------------------------------------------------------------------------
export interface PromptMetadata {
  templateVersion: SemVer;
  moduleVersions: Readonly<Record<PromptModuleType, SemVer>>;
  generatedAt: IsoTimestamp;
  generatorVersion: SemVer;
  promptChecksum: Sha256;
}

// ----------------------------------------------------------------------------
// SessionFingerprint (§3.18)
// ----------------------------------------------------------------------------
export interface SessionFingerprint {
  readonly hash: Sha256;
  readonly components: {
    readonly season: SeasonId;
    readonly audience: Audience;
    readonly productIds: readonly ProductId[];
    readonly colorIds: readonly ColorId[];
    readonly colorLocked: boolean;
    readonly requestedSceneCount: number;
    readonly sceneFingerprints: readonly Sha256[];
    readonly artworkContentHashes: readonly Sha256[];
    readonly ruleSetVersions: Readonly<Record<string, SchemaVersion>>;
    readonly isDigitalProduct: boolean;
  };
}
