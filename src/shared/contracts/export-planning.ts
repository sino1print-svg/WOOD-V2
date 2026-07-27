/**
 * Export planning contracts — EX §3, §6–§7, §10.2, §17–§18, §21.
 *
 * Planning selects allowlisted, read-only projections only. It does not format,
 * serialize, package, deliver, back up, or restore any artifact.
 */
import type {
  ArtworkId,
  Audience,
  CameraId,
  ColorId,
  CompositionId,
  CoverId,
  CoverLayout,
  DecorId,
  DisplayMethod,
  EngineId,
  ExportScope,
  GarmentView,
  GroupBy,
  GroupId,
  IsoTimestamp,
  LightingId,
  LocationId,
  OutputAId,
  OutputBId,
  OutputStatus,
  PaletteId,
  PersistenceMode,
  PoseId,
  PrintAreaRuleSetId,
  ProductId,
  ProductKind,
  ProjectId,
  PropId,
  PromptModuleType,
  RetentionPolicyKind,
  RuleDomain,
  RulePriorityClass,
  SceneId,
  SceneTemplateId,
  SchemaVersion,
  SeasonId,
  SeasonKind,
  SemVer,
  SessionId,
  SessionStatus,
  Sha256,
  ValidationCheck,
  ValidationFailure,
  ValidationSeverity,
  VersionId,
} from '../domain-model';
import type { ExportEngineInput, ExportOperationalScope } from './export-contracts';

export type * from '../../shared/contracts/export-contracts';
export type * from '../../shared/contracts/export-refinements';

export type ExportPlanningFailureCode =
  | 'EXPORT_SCOPE_001'
  | 'EXPORT_SCOPE_002'
  | 'EXPORT_MISSINGA_001'
  | 'EXPORT_LINK_001'
  | 'EXPORT_PNG_001'
  | 'EXPORT_STALE_001'
  | 'EXPORT_COVER_001'
  | 'EXPORT_COVERCOUNT_001'
  | 'EXPORT_CHECKSUM_001'
  | 'EXPORT_CORRUPT_001'
  | 'EXPORT_SCHEMA_001'
  | 'EXPORT_PROMPTVAR_001'
  | 'EXPORT_NUM_001'
  | 'EXPORT_GROUP_001';

export type ExportOutputALabel = `${number}A`;
export type ExportOutputBLabel = `${number}B`;
export type ExportGroupOutputALabel = `${number}.${number}-A`;
export type ExportGroupOutputBLabel = `${number}.${number}-B`;

export interface ExportNumberingEntry {
  readonly sessionId: SessionId;
  readonly sceneId: SceneId;
  readonly sceneNumber: number;
  readonly outputAId: OutputAId;
  readonly outputALabel: ExportOutputALabel;
  readonly outputBId?: OutputBId;
  readonly outputBLabel?: ExportOutputBLabel;
}

export interface ExportGroupNumberingEntry {
  readonly sessionId: SessionId;
  readonly groupId: GroupId;
  readonly groupNumber: number;
  readonly groupSceneNumber: number;
  readonly sceneId: SceneId;
  readonly sceneNumber: number;
  readonly outputAId: OutputAId;
  readonly outputALabel: ExportGroupOutputALabel;
  readonly outputBId?: OutputBId;
  readonly outputBLabel?: ExportGroupOutputBLabel;
}

export interface ExportScopeContentPolicy {
  readonly projectMetadata: boolean;
  readonly sessionMetadata: boolean;
  readonly sceneMetadata: boolean;
  readonly outputA: boolean;
  readonly outputB: boolean;
  readonly groupMetadata: boolean;
  readonly groupPlans: boolean;
  readonly executionPlans: boolean;
  readonly cover: boolean;
  readonly artworkMetadata: boolean;
  readonly validationResults: boolean;
  readonly versionMetadata: boolean;
  readonly backupResolutionOnly: boolean;
}

/** Concrete, canonically ordered entity IDs resolved from an operational scope. */
export interface ExportResolvedScope {
  readonly baseScope: ExportScope;
  readonly scopeDetail: ExportOperationalScope['scopeDetail'];
  readonly projectId: ProjectId;
  readonly sessionIds: readonly SessionId[];
  readonly groupIds: readonly GroupId[];
  readonly sceneIds: readonly SceneId[];
  readonly outputAIds: readonly OutputAId[];
  readonly outputBIds: readonly OutputBId[];
  readonly coverIds: readonly CoverId[];
  readonly versionIds: readonly VersionId[];
  readonly policy: ExportScopeContentPolicy;
}

export interface ExportSelectedPromptMetadata {
  readonly templateVersion: SemVer;
  readonly moduleVersions: Readonly<Record<PromptModuleType, SemVer>>;
  readonly generatedAt: IsoTimestamp;
  readonly generatorVersion: SemVer;
  readonly promptChecksum: Sha256;
}

export interface ExportSelectedProject {
  readonly id: ProjectId;
  readonly schemaVersion: SchemaVersion;
  readonly name: string;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly sessionIds: readonly SessionId[];
  readonly currentVersionId: VersionId | null;
  readonly versionIds: readonly VersionId[];
  readonly isDigitalProduct: boolean;
  readonly persistenceMode: PersistenceMode;
  readonly retention: {
    readonly kind: RetentionPolicyKind;
    readonly keepN?: number;
    readonly keepDays?: number;
  };
}

export interface ExportSelectedSession {
  readonly id: SessionId;
  readonly projectId: ProjectId;
  readonly name: string;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly seasonId: SeasonId;
  readonly audience: Audience;
  readonly productIds: readonly ProductId[];
  readonly colorSelection: {
    readonly colorIds: readonly ColorId[];
    readonly locked: boolean;
    readonly paletteId?: PaletteId;
  };
  readonly requestedSceneCount: number;
  readonly sceneIds: readonly SceneId[];
  readonly status: SessionStatus;
  readonly validationResultIds: readonly string[];
  readonly generationProgress: {
    readonly totalScenes: number;
    readonly outputAGenerated: number;
    readonly outputBGenerated: number;
    readonly coverGenerated: boolean;
    readonly allOutputAReady: boolean;
  };
  readonly fingerprint: {
    readonly hash: Sha256;
    readonly sceneFingerprints: readonly Sha256[];
    readonly artworkContentHashes: readonly Sha256[];
    readonly ruleSetVersions: Readonly<Record<string, SchemaVersion>>;
  };
}

export interface ExportSelectedScene {
  readonly id: SceneId;
  readonly sessionId: SessionId;
  readonly templateId: SceneTemplateId;
  readonly productId: ProductId;
  readonly locationId: LocationId;
  readonly lightingId: LightingId;
  readonly decorIds: readonly DecorId[];
  readonly propIds: readonly PropId[];
  readonly cameraId: CameraId;
  readonly compositionId: CompositionId;
  readonly poseId: PoseId;
  readonly displayMethod: DisplayMethod;
  readonly paletteColorId: ColorId;
  readonly seasonId: SeasonId;
  readonly printAreaRulesRef: PrintAreaRuleSetId;
  readonly view: GarmentView;
  readonly dedupSignature: {
    readonly sceneTemplateId: SceneTemplateId;
    readonly poseId: PoseId;
    readonly cameraAngle: string;
    readonly compositionId: CompositionId;
    readonly hash: Sha256;
  };
  readonly sceneVersion: number;
  readonly sceneHash: Sha256;
  readonly sceneFingerprint: Sha256;
}

export interface ExportSelectedOutputA {
  readonly id: OutputAId;
  readonly sessionId: SessionId;
  readonly sceneId: SceneId;
  readonly sceneNumber: number;
  readonly label: ExportOutputALabel;
  readonly garment: string;
  readonly color: ColorId;
  readonly view: GarmentView;
  readonly status: OutputStatus;
  readonly forbidden: readonly ['artwork', 'logo', 'watermark', 'typography'];
  readonly promptText: string;
  readonly contentHash: Sha256;
  readonly generatedAt: IsoTimestamp | null;
  readonly promptHash: Sha256;
  readonly renderHash: Sha256 | null;
  readonly promptMeta: ExportSelectedPromptMetadata | null;
}

export interface ExportSelectedOutputB {
  readonly id: OutputBId;
  readonly sessionId: SessionId;
  readonly sceneId: SceneId;
  readonly sceneNumber: number;
  readonly label: ExportOutputBLabel;
  readonly sourceOutputAId: OutputAId;
  readonly sourceOutputALabel: ExportOutputALabel;
  readonly artworkId: ArtworkId;
  readonly onlyArtworkChanges: true;
  readonly sourceContentHash: Sha256;
  readonly status: OutputStatus;
  readonly promptText: string;
  readonly generatedAt: IsoTimestamp | null;
  readonly promptHash: Sha256;
  readonly renderHash: Sha256 | null;
  readonly sourceHash: Sha256;
  readonly contentHash: Sha256;
  readonly promptMeta: ExportSelectedPromptMetadata | null;
}

export interface ExportSelectedGroup {
  readonly id: GroupId;
  readonly sessionId: SessionId;
  readonly groupNumber: number;
  readonly groupBy: GroupBy;
  readonly key: string;
  readonly sceneIds: readonly SceneId[];
}

export interface ExportSelectedGroupPlan {
  readonly groupId: GroupId;
  readonly sessionId: SessionId;
  readonly groupNumber: number;
  readonly promptText: string;
  readonly promptMeta: ExportSelectedPromptMetadata | null;
}

export interface ExportSelectedCover {
  readonly id: CoverId;
  readonly sessionId: SessionId;
  readonly sourceOutputAIds: readonly OutputAId[];
  readonly sourceOutputALabels: readonly ExportOutputALabel[];
  readonly layout: CoverLayout;
  readonly metadata: {
    readonly productIds: readonly ProductId[];
    readonly colors: readonly ColorId[];
    readonly mockupCount: number;
    readonly views: readonly GarmentView[];
    readonly seasonId: SeasonId;
    readonly digitalProductStatus: boolean;
    readonly primaryProduct: ProductId;
    readonly primaryColor: ColorId;
    readonly primaryView: GarmentView;
    readonly primaryAudience: Audience;
  };
  readonly status: OutputStatus;
  readonly promptText: string;
  readonly generatedAt: IsoTimestamp | null;
  readonly promptHash: Sha256;
  readonly renderHash: Sha256 | null;
  readonly coverHash: Sha256;
  readonly promptMeta: ExportSelectedPromptMetadata | null;
}

/** Explicit metadata allowlist: filename, AssetRef, local path, and bytes are absent. */
export interface ExportSelectedArtworkMetadata {
  readonly id: ArtworkId;
  readonly projectId: ProjectId;
  readonly uploadedAt: IsoTimestamp;
  readonly format: 'png';
  readonly hasTransparency: boolean;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly dpi?: number;
  readonly aspectRatio: number;
  readonly contentHash: Sha256;
}

export interface ExportSelectedProduct {
  readonly id: ProductId;
  readonly schemaVersion: SchemaVersion;
  readonly kind: ProductKind;
  readonly name: string;
  readonly type: string;
  readonly allowedViews: readonly GarmentView[];
  readonly defaultColors: readonly ColorId[];
  readonly productHash?: Sha256;
}

export interface ExportSelectedSeason {
  readonly id: SeasonId;
  readonly schemaVersion: SchemaVersion;
  readonly kind: SeasonKind;
  readonly name: string;
}

export interface ExportSelectedColor {
  readonly id: ColorId;
  readonly name: string;
  readonly hex: string;
}

export interface ExportSelectedValidationFailure {
  readonly check: ValidationCheck;
  readonly code: string;
  readonly severity: ValidationSeverity;
  readonly priorityClass: RulePriorityClass | null;
  readonly domain: RuleDomain | null;
  readonly originEngine: EngineId;
}

export interface ExportSelectedValidationResult {
  readonly id: string;
  readonly sessionId: SessionId;
  readonly evaluatedAt: IsoTimestamp;
  readonly passed: boolean;
  readonly checks: readonly {
    readonly check: ValidationCheck;
    readonly passed: boolean;
  }[];
  readonly failures: readonly ExportSelectedValidationFailure[];
}

export interface ExportSelectedVersionMetadata {
  readonly versionId: VersionId;
  readonly projectId: ProjectId;
  readonly timestamp: IsoTimestamp;
  readonly parentVersionId: VersionId | null;
  readonly reason: 'generated' | 'manual_save' | 'duplicate';
  readonly stateHash?: Sha256;
}

export interface ExportExecutionPlanEntryA {
  readonly sceneId: SceneId;
  readonly outputAId: OutputAId;
  readonly label: ExportOutputALabel;
}

export interface ExportExecutionPlanEntryB {
  readonly sceneId: SceneId;
  readonly outputBId: OutputBId;
  readonly label: ExportOutputBLabel;
  readonly sourceOutputAId: OutputAId;
  readonly sourceOutputALabel: ExportOutputALabel;
}

export interface ExportSelectedExecutionPlan {
  readonly sessionId: SessionId;
  readonly phase1: readonly ExportExecutionPlanEntryA[];
  readonly phase2: readonly ExportExecutionPlanEntryB[];
}

export type ExportOrderedSelectionKind =
  | 'project'
  | 'session'
  | 'group'
  | 'scene'
  | 'output_a'
  | 'output_b'
  | 'execution_plan'
  | 'cover'
  | 'version_snapshot';

export interface ExportOrderedSelectionReference {
  readonly kind: ExportOrderedSelectionKind;
  readonly entityId: string;
  readonly sessionId?: SessionId;
  readonly sceneId?: SceneId;
  readonly label?: ExportOutputALabel | ExportOutputBLabel;
}

/** Every field is copied from an explicit allowlist; source objects are never exposed. */
export interface ExportAllowlistedSelection {
  readonly project: ExportSelectedProject | null;
  readonly sessions: readonly ExportSelectedSession[];
  readonly groups: readonly ExportSelectedGroup[];
  readonly groupPlans: readonly ExportSelectedGroupPlan[];
  readonly scenes: readonly ExportSelectedScene[];
  readonly outputsA: readonly ExportSelectedOutputA[];
  readonly outputsB: readonly ExportSelectedOutputB[];
  readonly covers: readonly ExportSelectedCover[];
  readonly artworks: readonly ExportSelectedArtworkMetadata[];
  readonly products: readonly ExportSelectedProduct[];
  readonly seasons: readonly ExportSelectedSeason[];
  readonly colors: readonly ExportSelectedColor[];
  readonly validationResults: readonly ExportSelectedValidationResult[];
  readonly versions: readonly ExportSelectedVersionMetadata[];
  readonly executionPlans: readonly ExportSelectedExecutionPlan[];
  readonly ordered: readonly ExportOrderedSelectionReference[];
}

export type ExportOmittedArtifactKind =
  | 'output_a'
  | 'output_b'
  | 'group'
  | 'group_plan'
  | 'execution_plan'
  | 'cover'
  | 'artwork_metadata'
  | 'product_metadata'
  | 'season_metadata'
  | 'color_metadata';

export interface ExportPlanOmission {
  readonly artifactKind: ExportOmittedArtifactKind;
  readonly entityId: string;
  readonly field: string;
  readonly code: ExportPlanningFailureCode;
}

/**
 * Authoritative source provenance for the resolved scope - EX §13 manifest
 * `sourceFingerprints` (Batch 10.4 First Corrective F5). Computed directly from
 * the real source session(s)/scene(s)/cover in scope, independent of the
 * content policy that governs `selection` - so it remains available even for
 * scopes (e.g. `output_a`, `pair`, `cover`) whose `selection.sessions` is
 * empty. Never a placeholder, synthetic, random, or wall-clock-derived value.
 *
 * `sessionFingerprint` is the primary (canonically first) resolved session's
 * real `SessionFingerprint.hash` (DM §3.18 defines the fingerprint per-session;
 * there is no cross-session combined fingerprint in the domain model).
 * `sceneFingerprints` covers every resolved scene across every resolved
 * session, in canonical order. `coverHash` is the real selected cover's
 * `coverHash` when the resolved scope includes one, else `null`.
 */
export interface ExportPlanProvenance {
  readonly sessionFingerprint: Sha256;
  readonly sceneFingerprints: readonly Sha256[];
  readonly coverHash: Sha256 | null;
}

export interface ExportPlan {
  readonly scope: ExportResolvedScope;
  readonly numbering: readonly ExportNumberingEntry[];
  readonly groupNumbering: readonly ExportGroupNumberingEntry[];
  readonly selection: ExportAllowlistedSelection;
  readonly provenance: ExportPlanProvenance;
  readonly omissions: readonly ExportPlanOmission[];
  /** Includes both warning-severity and blocking-severity omitted-artifact diagnostics. */
  readonly issues: readonly ValidationFailure[];
  readonly partial: boolean;
}

export type ExportPlanResult =
  | { readonly ok: true; readonly value: ExportPlan }
  | { readonly ok: false; readonly failures: readonly ValidationFailure[] };

export interface ExportPlanningContract {
  createPlan(input: ExportEngineInput): ExportPlanResult;
}
