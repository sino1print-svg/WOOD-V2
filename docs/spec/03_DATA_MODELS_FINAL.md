# 03_DATA_MODELS_FINAL.md

# Mockup Photoshoot Director — Domain Data Models (FINAL / Authoritative)

**Document type:** Permanent Domain Model Specification (authoritative)
**Supersedes:** `03_DATA_MODELS.md`, `03_DATA_MODELS_REVISED.md`
**Sources of truth (only):** `01_PRD.md` v1.0, `02_ARCHITECTURE.md`
**Consistency targets:** `04_RULE_ENGINE_REVISED.md`
**Status:** Permanent source of truth for all future engineering.
**Scope note:** Declarative TypeScript type definitions only — no application logic, functions, components, HTML, or CSS. This FINAL edition **removes no existing type** and **simplifies nothing**; it only *adds* precision, extensibility, metadata, ownership, and audit structure. Every type from the REVISED edition is preserved verbatim or strictly extended.

`§` = `01_PRD.md`. `ARCH` = `02_ARCHITECTURE.md`. `RE` = `04_RULE_ENGINE_REVISED.md`. `[R#]` = resolved architecture gap (section 25).

---

## 0. What This Edition Adds (map of improvements 1–20)

| # | Improvement | Where |
|---|---|---|
| 1 | Expanded `RuleDomain` (+8 domains, justified) | §2.1 |
| 2 | `ContextFieldPath` strong typing + path grammar | §1.3, §3.12 |
| 3 | `RuleTarget` discriminated union | §3.12 |
| 4 | `NumericExpression` deterministic expression model | §3.12 |
| 5 | `ResolvedRule/Condition/Target/Effect` (non-persisted) | §3.16 |
| 6 | `EvaluationContext` runtime clarification | §3.15 |
| 7 | Scene metadata: `sceneVersion`, `sceneHash`, `sceneFingerprint` | §3.5 |
| 8 | Output metadata: `promptHash`, `renderHash`, `contentHash`, `sourceHash` | §3.6–3.7 |
| 9 | `ValidationFailure`: `ruleId`, `priorityClass`, `domain`, `originEngine` | §3.13 |
| 10 | `CoverMetadata`: `primaryProduct/Color/View/Audience` | §3.9 |
| 11 | `PromptMetadata` | §3.17 |
| 12 | `SessionFingerprint` | §3.18 |
| 13 | Stable hashing policy | §18 |
| 14 | Immutable/mutable/derived/computed tables | §19 |
| 15 | Engine ownership (per field) | §20 |
| 16 | Event model | §3.19 |
| 17 | Future-compatibility review | §21 |
| 18 | Performance considerations | §22 |
| 19 | Final consistency audit | §23 |
| 20 | Compatibility appendix (6 checklists) | §24 |

---

## 1. Conventions

### 1.1 Modeling conventions

- **Branded IDs.** Every entity has a nominal, non-interchangeable identifier. This prevents cross-entity ID confusion at compile time.
- **Timestamps.** ISO-8601 UTC strings, typed `IsoTimestamp`. No local time is stored. Timestamps never participate in fingerprints (§3.18).
- **Optionality.** A field is `?` only when its absence is semantically valid. Invariant-required fields are never optional at the type level.
- **`readonly`.** Fields immutable after creation (IDs, `createdAt`, generated-artifact snapshots) are `readonly`.
- **Normalization.** Cross-entity relationships are stored by reference (ID), not embedded, unless the child cannot exist without its parent (§17). Referenced-by-ID entities live in normalized maps keyed by ID.
- **Schema version.** Every persisted root aggregate and library manifest carries `schemaVersion`. Current versions in §16.
- **Controlled vocabularies.** Closed sets are enums; open expandable sets are ID references into data-library vocabularies (§6/§15; ARCH §10.1).
- **Hashing.** All hashes are `Sha256` over a canonical, key-sorted serialization with timestamps and volatile fields excluded per the hashing policy (§18).
- **Determinism.** No unseeded randomness anywhere; all ordering is lexicographic on branded IDs (§2; RE §1.3).

### 1.2 Shared primitives

```typescript
export type IsoTimestamp = string & { readonly __brand: 'IsoTimestamp' };
export type SchemaVersion = number;
export type Sha256 = string & { readonly __brand: 'Sha256' };
export type ById<Id extends string, T> = Readonly<Record<Id, T>>;
export type HexColor = string & { readonly __brand: 'HexColor' };
export type SemVer = string & { readonly __brand: 'SemVer' }; // e.g. "1.4.0"; used for versioned generators/templates

// ---- Branded entity identifiers (all preserved) ----
export type ProjectId          = string & { readonly __brand: 'ProjectId' };
export type SessionId          = string & { readonly __brand: 'SessionId' };
export type ProductId          = string & { readonly __brand: 'ProductId' };
export type SeasonId           = string & { readonly __brand: 'SeasonId' };
export type SceneId            = string & { readonly __brand: 'SceneId' };
export type SceneTemplateId    = string & { readonly __brand: 'SceneTemplateId' };
export type OutputAId          = string & { readonly __brand: 'OutputAId' };
export type OutputBId          = string & { readonly __brand: 'OutputBId' };
export type ArtworkId          = string & { readonly __brand: 'ArtworkId' };
export type CoverId            = string & { readonly __brand: 'CoverId' };
export type GroupId            = string & { readonly __brand: 'GroupId' };
export type PaletteId          = string & { readonly __brand: 'PaletteId' };
export type ColorId            = string & { readonly __brand: 'ColorId' };
export type RuleId             = string & { readonly __brand: 'RuleId' };
export type RuleSetId          = string & { readonly __brand: 'RuleSetId' };
export type PromptModuleId     = string & { readonly __brand: 'PromptModuleId' };
export type PrintAreaRuleSetId = string & { readonly __brand: 'PrintAreaRuleSetId' };
export type ValidationResultId = string & { readonly __brand: 'ValidationResultId' };
export type VersionId          = string & { readonly __brand: 'VersionId' };
export type AssetRef           = string & { readonly __brand: 'AssetRef' };
export type EventId            = string & { readonly __brand: 'EventId' }; // NEW (§3.19)

// ---- Vocabulary reference ids (open, data-library-backed) ----
export type LocationId     = string & { readonly __brand: 'LocationId' };
export type LightingId     = string & { readonly __brand: 'LightingId' };
export type DecorId        = string & { readonly __brand: 'DecorId' };
export type PropId         = string & { readonly __brand: 'PropId' };
export type CameraId       = string & { readonly __brand: 'CameraId' };
export type CompositionId  = string & { readonly __brand: 'CompositionId' };
export type PoseId         = string & { readonly __brand: 'PoseId' };
export type VocabularyId   = string & { readonly __brand: 'VocabularyId' };
```

### 1.3 `ContextFieldPath` (improvement #2)

Rule conditions and dynamic references address the Rule Engine's read-only `EvaluationContext` (§3.15) by **path**. A bare `string` cannot distinguish a runtime context path from an arbitrary literal, so a dedicated branded type is introduced:

```typescript
/** A dot-delimited path into the read-only EvaluationContext (§3.15).
 *  Strongly distinguished from ordinary strings so tooling and schema
 *  validation can verify that the path resolves to a known context node. */
export type ContextFieldPath = string & { readonly __brand: 'ContextFieldPath' };
```

**Allowable path syntax (grammar).**

```
path        := root ( "." segment )*
root        := "session" | "scene" | "printArea" | "background"
             | "output" | "outputB" | "artwork" | "generationProgress" | "cover"
segment     := identifier
identifier  := [a-z][a-zA-Z0-9]*        // camelCase, no array indexing
```

Rules:
- Every `path` must resolve to a declared node of `EvaluationContext` (§3.15); an unresolved path is a load-time configuration error `RULE_CFG_002` (RE §14).
- **No array indexing** (`decorIds[0]` is illegal). Array fields are addressed whole and tested with `Includes`/`Excludes`/`Count*` (RE §12).
- Paths are pure locators — no function calls or operators inside a path.
- Both `RuleCondition.field` and `ContextRef.ref` are `ContextFieldPath` (§3.12).

---

## 2. Enumerations and Controlled Vocabularies

### 2.1 Closed enumerations

All prior enums are preserved. `RuleDomain` is **expanded** (improvement #1); `EngineId`, `SceneDimension`, `SymbolicTarget` are **new** supporting enums.

```typescript
// ===== PRESERVED, UNCHANGED =====
export enum ProductKind {
  BellaCanvas3001 = 'bella_canvas_3001', ClassicTShirt = 'classic_tshirt',
  ComfortColors = 'comfort_colors', Oversized = 'oversized', Hoodie = 'hoodie',
  Crewneck = 'crewneck', Kids = 'kids', Tank = 'tank', Polo = 'polo',
  Raglan = 'raglan', ZipHoodie = 'zip_hoodie',
}
export enum SeasonKind {
  Halloween = 'halloween', Christmas = 'christmas', ValentinesDay = 'valentines_day',
  MothersDay = 'mothers_day', FathersDay = 'fathers_day', BackToSchool = 'back_to_school',
  Summer = 'summer', Fall = 'fall', Winter = 'winter', Teacher = 'teacher',
  MinimalStudio = 'minimal_studio',
}
export enum Audience { Kids = 'kids', Adult = 'adult', Unisex = 'unisex', Teen = 'teen', All = 'all' }
export enum GarmentView { Front = 'front', Back = 'back', Side = 'side', FlatDetail = 'flat_detail' }
export enum DisplayMethod {
  OnModel = 'on_model', FlatLay = 'flat_lay', Hanger = 'hanger', Folded = 'folded',
  GhostMannequin = 'ghost_mannequin', Hanging = 'hanging',
}
export enum CameraAngle {
  Eye = 'eye_level', High = 'high_angle', Low = 'low_angle', TopDown = 'top_down',
  ThreeQuarter = 'three_quarter', Straight = 'straight_on',
}
export enum SessionStatus {
  Draft = 'draft', Validating = 'validating', Blocked = 'blocked', Generating = 'generating',
  CoverBuild = 'cover_build', Ready = 'ready', Exported = 'exported',
}
export enum OutputStatus { Pending = 'pending', Generated = 'generated', Stale = 'stale' }
export enum CoverLayout {
  Single = 'single', Duo = 'duo', Triptych = 'triptych', Grid2x2 = 'grid_2x2',
  Grid2x3 = 'grid_2x3', Grid3x3 = 'grid_3x3', Mosaic = 'mosaic',
}
export enum RuleEffectType { Forbid = 'forbid', Require = 'require', Lock = 'lock', Limit = 'limit' }
export enum RuleOperator {
  Equals = 'eq', NotEquals = 'neq', In = 'in', NotIn = 'not_in',
  Includes = 'includes', Excludes = 'excludes',
  CountEquals = 'count_eq', CountGte = 'count_gte', CountLte = 'count_lte',
  NumberEquals = 'num_eq', NumberGte = 'num_gte', NumberLte = 'num_lte',
  NumberGt = 'num_gt', NumberLt = 'num_lt',
  Exists = 'exists', IsNull = 'is_null',
}
export enum RulePriorityClass {
  PrintArea = 1, AudienceSafety = 2, Season = 3, PaletteLock = 4, SceneAesthetic = 5,
}
export enum PromptModuleType {
  Global = 'global', Product = 'product', Season = 'season', Scene = 'scene',
  OutputA = 'output_a', OutputB = 'output_b', Cover = 'cover', Group = 'group',
}
export enum ExportScope { Output = 'output', Group = 'group', Cover = 'cover', Session = 'session', All = 'all' }
export enum ExportFormat { Txt = 'txt', Json = 'json', Zip = 'zip' }
export enum GroupBy { Product = 'product', Color = 'color', View = 'view' }
export enum ValidationCheck {
  Season = 'season', Audience = 'audience', Products = 'products', Colors = 'colors',
  SceneCount = 'scene_count', DuplicateScenes = 'duplicate_scenes',
  PrintRules = 'print_rules', CoverData = 'cover_data',
}
export enum ValidationSeverity { Blocking = 'blocking', Warning = 'warning' }
export enum PersistenceMode { LocalSingleUser = 'local_single_user' }
export enum RetentionPolicyKind { KeepAll = 'keep_all', KeepLastN = 'keep_last_n', KeepDays = 'keep_days' }
export enum PrintAreaObstruction {
  Hands = 'hands', Hair = 'hair', Props = 'props', DeepFolds = 'deep_folds', Shadows = 'shadows',
}
export enum VocabularyKind {
  Location = 'location', Lighting = 'lighting', Decor = 'decor', Prop = 'prop',
  Composition = 'composition', Pose = 'pose', Camera = 'camera',
}

// ===== EXPANDED: RuleDomain (improvement #1) =====
/** Prior 8 domains preserved; 8 new domains added. Each new domain maps to a
 *  concrete engine/coordinator in ARCH §3 and isolates that engine's rule space
 *  so cross-engine coupling cannot arise (RE §6 domain-isolation principle). */
export enum RuleDomain {
  // ---- preserved ----
  PrintArea    = 'print_area',    // Print-Area Engine — obstruction/collage/background text
  Background   = 'background',    // Print-Area/Scene — backdrop legibility
  Output       = 'output',        // Prompt/Output — Output A/B invariants
  Model        = 'model',         // Scene Engine — audience/model safety
  Decor        = 'decor',         // Scene Engine — seasonal decor
  GarmentColor = 'garment_color', // Palette Engine (application) — per-scene garment color
  Composition  = 'composition',   // Scene/Dedup — pose/camera/composition, counts
  Cover        = 'cover',         // Cover Engine — cover purity/layout/barrier
  // ---- NEW ----
  Palette      = 'palette',       // Palette Engine (selection) — color-set closure at selection level
  Product      = 'product',       // Scene/Rule — product-manifest compatibility (audience/views)
  Validation   = 'validation',    // Validation Engine — structural pre-flight predicates
  Artwork      = 'artwork',       // Asset — uploaded PNG constraints (format/transparency/aspect)
  Prompt       = 'prompt',        // Prompt Engine — module/template governance
  Session      = 'session',       // Orchestrator — session legality/presence
  Export       = 'export',        // Export Coordinator — export scope/format governance
  Group        = 'group',         // Group formation — group-by consistency
}

// ===== NEW supporting enums =====
/** Canonical engine identity; used by ValidationFailure.originEngine and ownership (§20). */
export enum EngineId {
  Orchestrator = 'orchestrator', Rule = 'rule', Scene = 'scene', Prompt = 'prompt',
  PrintArea = 'print_area', Cover = 'cover', Dedup = 'dedup', Palette = 'palette',
  Validation = 'validation', Export = 'export', Persistence = 'persistence', Asset = 'asset',
}

/** The addressable scene dimensions (RuleTarget kind 'dimension', §3.12). */
export enum SceneDimension {
  Product = 'product', Location = 'location', Lighting = 'lighting', Decor = 'decor',
  Props = 'props', Camera = 'camera', Composition = 'composition', Pose = 'pose',
  DisplayMethod = 'display_method', GarmentColor = 'garment_color', View = 'view',
  PrintAreaRules = 'print_area_rules', Season = 'season',
}

/** Pipeline-level symbolic targets (RuleTarget kind 'symbolic', §3.12).
 *  Abstract actions a rule can forbid/require that are not literal term ids. */
export enum SymbolicTarget {
  Generation          = 'generation',
  CoverBuild          = 'cover_build',
  CoverPublish        = 'cover.publish',
  ArtworkUpload       = 'artwork.upload',
  OutputBPublish      = 'outputB.publish',
  OutputBInCover      = 'outputB_in_cover',
  ReadableBackground  = 'readable_background_text',
  CollageOutput       = 'collage_output',
  SeasonalDecor       = 'seasonal_decor',
  NonSelectedColors   = 'non_selected_colors',
  SceneDedupSignature = 'scene.dedupSignature',
  PrintAreaTooSmall   = 'print_area_too_small',
  PrintAreaCentered   = 'print_area_centered',
  PrintAreaMinSize    = 'print_area_min_size',
}
```

**Reasoning for each new `RuleDomain`:**

- **`Palette`** — selection-level color-set rules (the `ColorSelection.locked` closure, White+Black) are distinct from `GarmentColor` (per-scene applied garment color). Owner: Palette Engine. Value: separates "which colors may be selected" from "which color a scene applies," so selection policy evolves without touching per-scene rules.
- **`Product`** — product-manifest compatibility (P-1..P-5, RE §17.2: audience/view legality) previously borrowed `Model`/`Composition`. A dedicated domain co-locates all product-catalog constraints. Value: adding a product changes only `Product`-domain rules.
- **`Validation`** — structural pre-flight predicates (presence of season/audience/products/colors/scene count, Phase 0) are not content rules. Value: isolates "is the session well-formed" from "is the content compliant."
- **`Artwork`** — uploaded PNG constraints (format, transparency, aspect) concern an asset, not an output prompt. Owner: Asset. Value: artwork lifecycle rules evolve independently of Output-generation rules.
- **`Prompt`** — prompt module/template governance (which modules compose, template constraints) for the future Prompt Engine. Value: prompt tuning (a high-churn activity, §15) is a self-contained domain.
- **`Session`** — session legality/orchestration rules (audience-product coherence, generation gating) owned by the Orchestrator. Value: cross-selection legality lives in one place.
- **`Export`** — export scope/format governance (§12) for the Export Coordinator. Value: export policy (allowed scopes/formats) extends without touching content rules.
- **`Group`** — group formation/consistency (§10/§12: all members share the `groupBy` value). Value: group semantics are a distinct concern from scene assembly.

Domain-isolation invariant (generalized from RE §6): a rule affects only its declared `domain`'s dimension; a `Season`-priority rule may never carry `domain === RuleDomain.GarmentColor` (else `RULE_CFG_003`).

### 2.2 Open controlled vocabularies (preserved)

```typescript
export interface VocabularyTerm {
  readonly id: VocabularyId;
  readonly kind: VocabularyKind;
  readonly label: string;
  readonly tags: readonly string[];
  readonly printAreaSafe: boolean;
}
export interface ControlledVocabularies {
  readonly locations:    ById<LocationId, VocabularyTerm>;
  readonly lightings:    ById<LightingId, VocabularyTerm>;
  readonly decors:       ById<DecorId, VocabularyTerm>;
  readonly props:        ById<PropId, VocabularyTerm>;
  readonly compositions: ById<CompositionId, VocabularyTerm>;
  readonly poses:        ById<PoseId, VocabularyTerm>;
  readonly cameras:      ById<CameraId, CameraTerm>;
}
export interface CameraTerm extends VocabularyTerm {
  readonly kind: VocabularyKind.Camera;
  readonly angle: CameraAngle;
  readonly distance?: 'close' | 'medium' | 'wide';
}
```

---

## 3. Domain Entities

All prior entities are preserved. Extensions are marked **NEW**.

### 3.1 Project (§13)

```typescript
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
  isDigitalProduct: boolean;                 // [R6]
  persistenceMode: PersistenceMode;          // [R11]
  ownerRef?: string;
  retention: RetentionPolicy;                // [R10]
  artworks: ById<ArtworkId, Artwork>;
}
```

### 3.2 PhotoshootSession (§3)

```typescript
export interface PhotoshootSession {
  readonly id: SessionId;
  readonly projectId: ProjectId;
  name: string;
  readonly createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  season: SeasonId;
  audience: Audience;                        // [R1]
  productIds: readonly ProductId[];
  colorSelection: ColorSelection;
  requestedSceneCount: number;
  scenes: ById<SceneId, Scene>;
  sceneOrder: readonly SceneId[];
  groups: ById<GroupId, Group>;              // [R9]
  cover: MainCover | null;
  status: SessionStatus;
  validationResultId: ValidationResultId | null;
  validationResults: ById<ValidationResultId, ValidationResult>;
  dedupLedger: DedupLedger;
  generationProgress: GenerationProgress;
  fingerprint: SessionFingerprint;           // NEW (#12, §3.18) — derived, computed
}

export interface GenerationProgress {
  totalScenes: number;
  outputAGenerated: number;
  outputBGenerated: number;
  coverGenerated: boolean;
  allOutputAReady: boolean;                  // = (outputAGenerated === totalScenes) (RE §8)
}
```

### 3.3 Product (§6)

```typescript
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
  productHash?: Sha256;                       // NEW (#13) — content hash of the manifest
}
export interface AudienceConstraints {
  forbidAdultModels?: boolean;
  kidsOnly?: boolean;
  allowedAudiences?: readonly Audience[];
}
export interface PrintAreaProfile {
  readonly id: PrintAreaRuleSetId;
  position: 'center_chest' | 'full_front' | 'left_chest' | 'center_back';
  minSizeRatio: number;                       // PA-PRED-1 (RE §7)
  centeringTolerance: number;                 // PA-PRED-2
  centered: boolean;
  maxShadowCoverage: number;                  // PA-PRED-3
  forbiddenOverlaps: readonly PrintAreaObstruction[];
}
```

### 3.4 Season (§7)

```typescript
export interface Season {
  readonly id: SeasonId;
  readonly schemaVersion: SchemaVersion;
  readonly kind: SeasonKind;
  name: string;
  sceneLibraryRef: VocabularyId;
  decorConstraints: readonly RuleId[];        // domain: decor/background
  heroSceneConstraints: readonly RuleId[];
  forbiddenSeasonDecor: readonly DecorId[];
}
```

### 3.5 Scene (§9) — extended with scene metadata (improvement #7)

```typescript
export interface Scene {
  readonly id: SceneId;
  readonly sessionId: SessionId;
  readonly templateId: SceneTemplateId;

  // ---- The 11 §9 dimensions (all required) ----
  productId: ProductId;
  locationId: LocationId;
  lightingId: LightingId;
  decorIds: readonly DecorId[];
  propIds: readonly PropId[];
  cameraId: CameraId;
  compositionId: CompositionId;
  poseId: PoseId;
  displayMethod: DisplayMethod;
  paletteColorId: ColorId;                    // garment color (RuleDomain.GarmentColor)
  seasonId: SeasonId;
  printAreaRulesRef: PrintAreaRuleSetId;
  view: GarmentView;

  // ---- Dedup (§8) ----
  dedupSignature: DedupSignature;

  // ---- Outputs (§4) ----
  outputA: OutputA;
  outputB: OutputB | null;

  // ---- NEW metadata (#7) ----
  sceneVersion: number;                       // monotonic counter; +1 on ANY edit (even cosmetic)
  sceneHash: Sha256;                          // integrity hash of ALL persisted scene fields
  sceneFingerprint: Sha256;                   // hash of GENERATION-AFFECTING dimensions only
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
```

**Scene metadata semantics (improvement #7):**

- **`sceneVersion`** — a monotonic integer incremented on *every* mutation of the scene, including non-generation-affecting ones (e.g. reordering, renaming). Purely an optimistic-concurrency / change counter. Never triggers regeneration by itself.
- **`sceneHash`** — a `Sha256` over **all** persisted scene fields (every dimension + `view` + `templateId`, excluding the metadata trio and outputs). Detects any content drift for integrity/version-history diffing.
- **`sceneFingerprint`** — a `Sha256` over only the **generation-affecting** dimensions (the 11 §9 dimensions + `view`; excludes `sceneVersion`, `sceneHash`, ordering, name). It is the semantic identity of the scene for **regeneration decisions**.
- **Regeneration behavior:** if `sceneFingerprint` changes, `outputA` → `Pending` and any `outputB` → `Stale` (must regenerate). If only `sceneVersion` bumps while `sceneFingerprint` is unchanged, **no regeneration** occurs (idempotence, ARCH §1.3). `dedupSignature.hash` remains the narrower four-part uniqueness key (§8); `sceneFingerprint` is the broader regeneration key.

### 3.6 OutputA — Blank Sale Image (§4) — extended output metadata (#8)

```typescript
export interface OutputA {
  readonly id: OutputAId;
  readonly sceneId: SceneId;
  garment: string;
  color: ColorId;
  view: GarmentView;
  status: OutputStatus;
  readonly forbidden: readonly ['artwork', 'logo', 'watermark', 'typography'];
  promptText: string;
  contentHash: Sha256;                        // PRESERVED — overall content integrity
  readonly generatedAt: IsoTimestamp | null;
  // ---- NEW metadata (#8) ----
  promptHash: Sha256;                         // hash of the composed prompt spec/text
  renderHash: Sha256 | null;                  // hash of the rendered image bytes (null until rendered)
  promptMeta: PromptMetadata | null;          // (#11) reproducibility metadata
}
```

### 3.7 OutputB — Matching Preview Image (§4) — extended output metadata (#8)

```typescript
export interface OutputB {
  readonly id: OutputBId;
  readonly sceneId: SceneId;
  readonly sourceOutputAId: OutputAId;        // REQUIRED (§4)
  readonly artworkId: ArtworkId;              // REQUIRED (§4)
  readonly onlyArtworkChanges: true;
  sourceContentHash: Sha256;                  // PRESERVED — pinned source A content hash
  status: OutputStatus;
  promptText: string;
  readonly generatedAt: IsoTimestamp | null;
  // ---- NEW metadata (#8) ----
  promptHash: Sha256;                         // hash of the composed preview prompt
  renderHash: Sha256 | null;                  // hash of rendered preview bytes
  sourceHash: Sha256;                         // = referenced OutputA.contentHash at gen time (alias of sourceContentHash, formalized)
  contentHash: Sha256;                        // NEW — B's own content integrity (source + artwork + prompt)
  promptMeta: PromptMetadata | null;
}
```

**Output hash semantics (improvement #8):**

- **`promptHash`** — hash of the *composed prompt* (modules + resolved variables). Changes when any prompt module/template or resolved value changes, even if the scene is otherwise identical. Enables prompt-level cache/reproducibility.
- **`renderHash`** — hash of the *rendered image bytes*. `null` until an image exists. Detects render drift independently of the prompt.
- **`contentHash`** — the *overall content integrity* hash of the output (Output A: garment+color+view+prompt; Output B: source + artwork + prompt). This is the canonical "did this output change" hash used by staleness/version-history.
- **`sourceHash`** (Output B only) — the pinned `contentHash` of the source Output A at generation time; `sourceHash !== source.contentHash` ⇒ `Stale` (RE §18 `outputB.isStale`). Formalizes the prior `sourceContentHash` (kept as an alias for backward compatibility).

### 3.8 Artwork (§4) — [R8]

```typescript
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
  contentHash: Sha256;                        // PRESERVED — asset content hash
}
```

### 3.9 MainCover (§5) — CoverMetadata extended (#10)

```typescript
export interface MainCover {
  readonly id: CoverId;
  readonly sessionId: SessionId;
  readonly sourceSaleImageIds: readonly OutputAId[]; // Output A ONLY (§5)
  layout: CoverLayout;
  readMetadata: CoverMetadata;
  status: OutputStatus;
  promptText: string;
  readonly generatedAt: IsoTimestamp | null;
  promptHash: Sha256;                          // NEW (#8/#13)
  renderHash: Sha256 | null;                   // NEW
  coverHash: Sha256;                           // NEW (#13) — hash of sources + layout + metadata
  promptMeta: PromptMetadata | null;           // NEW (#11)
}

export interface CoverMetadata {
  productIds: readonly ProductId[];
  colors: readonly ColorId[];
  mockupCount: number;
  views: readonly GarmentView[];
  seasonId: SeasonId;
  digitalProductStatus: boolean;               // [R6]
  // ---- NEW primaries (#10) ----
  primaryProduct: ProductId;
  primaryColor: ColorId;
  primaryView: GarmentView;
  primaryAudience: Audience;
}
```

**Automatic primary selection (improvement #10, deterministic):** the Cover Engine computes each `primary*` as the **mode** (most frequent value across the session's Sale Images); ties are broken by **lexicographically smallest branded ID / enum value** — no randomness. `primaryAudience` is the session `audience` (single-valued). These primaries drive cover emphasis/layout hierarchy (§5 "layout changes automatically") deterministically and are recomputed whenever `sourceSaleImageIds` change.

### 3.10 Group (§10, §12) — [R9]

```typescript
export interface Group {
  readonly id: GroupId;
  readonly sessionId: SessionId;
  groupBy: GroupBy;
  key: ProductId | ColorId | GarmentView;
  sceneIds: readonly SceneId[];
  groupPromptText: string | null;
  groupPromptMeta?: PromptMetadata | null;     // NEW (#11) — reproducibility of Group Prompt (§10)
}
```

### 3.11 ColorSelection / Palette (§8)

```typescript
export interface Color { readonly id: ColorId; name: string; hex: HexColor; }
export interface Palette {
  readonly id: PaletteId;
  readonly schemaVersion: SchemaVersion;
  name: string;
  colorIds: readonly ColorId[];
  lockRules: readonly RuleId[];                // domain: palette / garment_color
}
export interface ColorSelection {
  colorIds: readonly ColorId[];
  locked: boolean;                             // §8 — lock closes to ACTUAL colorIds via ContextRef
  paletteId?: PaletteId;
}
```

### 3.12 Rule cluster (preserved + improvements #2, #3, #4)

```typescript
/** #2 — condition/reference fields are strongly-typed paths. */
export interface RuleCondition {
  field: ContextFieldPath;                     // was string
  operator: RuleOperator;
  value: string | number | boolean | null | readonly string[];
}
export type ConditionNode = RuleCondition | ConditionGroup;
export type ConditionGroup =
  | { readonly all: readonly ConditionNode[] }
  | { readonly any: readonly ConditionNode[] }
  | { readonly not: ConditionNode };

/** PRESERVED — dynamic reference; its `ref` is now a ContextFieldPath. */
export interface ContextRef { readonly ref: ContextFieldPath; }

/** #3 — RuleTarget: extensible discriminated union. RuleEffect no longer needs to
 *  change when new target kinds appear; only this union grows. */
export type RuleTarget =
  | { readonly kind: 'literal';    readonly value: string }          // a term id / obstruction token
  | { readonly kind: 'contextRef'; readonly ref: ContextRef }        // dynamic set from context
  | { readonly kind: 'dimension';  readonly dimension: SceneDimension } // an entire scene dimension
  | { readonly kind: 'symbolic';   readonly symbol: SymbolicTarget };  // a pipeline-level action

/** #4 — NumericExpression: deterministic, side-effect-free numeric model.
 *  Supports literals, context references, arithmetic, and pure functions such as
 *  minimum()/maximum(). No runtime implementation — data contract only. */
export type NumericExpression =
  | { readonly kind: 'literal';    readonly value: number }
  | { readonly kind: 'contextRef'; readonly ref: ContextRef }
  | { readonly kind: 'binary';     readonly op: '+' | '-' | '*' | '/';
      readonly left: NumericExpression; readonly right: NumericExpression }
  | { readonly kind: 'function';   readonly fn: 'minimum' | 'maximum' | 'floor' | 'ceil';
      readonly args: readonly NumericExpression[] };

/** #3/#4 — RuleEffect: targets are RuleTarget[]; limit is a NumericExpression.
 *  Backward compatibility: a literal `number` limit maps to {kind:'literal'};
 *  a `ContextRef` limit maps to {kind:'contextRef'}; a literal string target maps
 *  to {kind:'literal'}. No prior expressiveness is lost. */
export interface RuleEffect {
  type: RuleEffectType;
  targets: readonly RuleTarget[];
  limit?: NumericExpression;
}

export interface Rule {
  readonly id: RuleId;
  priority: RulePriorityClass;
  domain: RuleDomain;                          // expanded set (§2.1)
  condition: ConditionNode;
  effect: RuleEffect;
  description?: string;
}
export interface RuleSet {
  readonly id: RuleSetId;
  readonly schemaVersion: SchemaVersion;       // current = 3 (§16)
  name: string;
  ruleIds: readonly RuleId[];
}
```

**Why `RuleTarget` (improvement #3):** the prior `(string | ContextRef)[]` conflated three distinct concepts (literal term, dynamic set, pipeline action) and could not express "an entire dimension" or future kinds (tag-match, expression-target) without widening `RuleEffect`. A discriminated union localizes all future growth to `RuleTarget`, keeping `RuleEffect`'s shape stable forever.

**Why `NumericExpression` (improvement #4):** the prior `number | ContextRef` could express `requestedSceneCount` but not `requestedSceneCount - 1`, `+ 2`, or `minimum(a, b)`. The expression tree is deterministic (pure functions, no randomness), evaluates to a single number, and covers the required future use cases while remaining a pure data contract.

### 3.13 ValidationResult (§14) — ValidationFailure extended (#9)

```typescript
export interface ValidationResult {
  readonly id: ValidationResultId;
  readonly sessionId: SessionId;
  readonly evaluatedAt: IsoTimestamp;
  passed: boolean;
  checks: readonly ValidationCheckResult[];
  failures: readonly ValidationFailure[];
}
export interface ValidationCheckResult { check: ValidationCheck; passed: boolean; }

export interface ValidationFailure {
  check: ValidationCheck;
  field: ContextFieldPath | string;            // context path when available
  code: string;                                // RULE_* (RE §14)
  message: string;                             // Arabic user-facing (RE §14)
  severity: ValidationSeverity;
  // ---- NEW diagnostics (#9) ----
  ruleId: RuleId | null;                       // originating rule (null for pure predicates like PA-PRED-*)
  priorityClass: RulePriorityClass | null;     // precedence class of the rule
  domain: RuleDomain | null;                   // rule domain
  originEngine: EngineId;                       // which engine raised it
}
```

**Why these diagnostics (improvement #9):** a blocking failure must be traceable to a single cause. `ruleId` identifies the exact rule (or `null` for Validation-Engine predicates); `priorityClass` explains why it outranked or dropped others; `domain` scopes the concern; `originEngine` tells operators which engine to inspect. Together they make every blocking halt reproducible and debuggable without re-running the pipeline (RE §15 explainability).

### 3.14 VersionSnapshot (§13)

```typescript
export interface VersionSnapshot {
  readonly versionId: VersionId;
  readonly projectId: ProjectId;
  readonly timestamp: IsoTimestamp;
  readonly parentVersionId: VersionId | null;
  readonly projectState: SerializedProjectState;
  readonly reason: 'generated' | 'manual_save' | 'duplicate';
  readonly stateHash?: Sha256;                 // NEW (#13) — hash of projectState for dedup/diff
}
export type SerializedProjectState = string & { readonly __brand: 'SerializedProjectState' };
export interface RetentionPolicy { kind: RetentionPolicyKind; keepN?: number; keepDays?: number; }
```

### 3.15 EvaluationContext (improvement #6 — runtime clarification)

```typescript
/**
 * EvaluationContext — RUNTIME-ONLY.
 *   • runtime generated  : built fresh by the Rule Engine at each evaluation.
 *   • read only          : engines may read; NONE may mutate it.
 *   • never serialized   : has no schemaVersion and is never written to JSON/persistence.
 *   • never persisted    : absent from Project/Session/VersionSnapshot state.
 *   • recreated every evaluation : derived fields are recomputed from persisted
 *     entities + engine measurements on every run, guaranteeing determinism.
 * It is a projection, NOT an entity. Adding a field here is NOT a persisted-schema change.
 */
export interface EvaluationContext {
  session: {
    audience: Audience;
    season: SeasonId;
    productIds: readonly ProductId[];
    colorSelection: { colorIds: readonly ColorId[]; locked: boolean };
    requestedSceneCount: number;
  };
  scene: {
    productId: ProductId; decorIds: readonly DecorId[]; propIds: readonly PropId[];
    poseId: PoseId; cameraAngle: CameraAngle; compositionId: CompositionId;
    displayMethod: DisplayMethod; paletteColorId: ColorId; view: GarmentView;
    modelType: 'adult_model' | 'teen_model' | 'child_model' | 'none'; // derived: Scene Engine
    isDuplicate: boolean;                        // derived: Dedup Engine
    garmentColorAllowed: boolean;                // derived: Palette Engine
  };
  printArea: {
    overlaps: readonly PrintAreaObstruction[];   // measured: Print-Area Engine
    sizeRatio: number; centeringOffset: number; shadowCoverage: number; // measured; judged by PA-PRED-*
  };
  background: { hasReadableText: boolean };
  output: { isCollage: boolean; saleImageHasMarks: boolean };
  outputB: { sourceOutputAId: OutputAId | null; artworkId: ArtworkId | null; isStale: boolean };
  artwork: { format: string; hasTransparency: boolean };
  generationProgress: { outputAGenerated: number; totalScenes: number; allOutputAReady: boolean };
  cover: {
    sourceRefKinds: readonly ('outputA' | 'outputB')[];
    hasPreviewRefs: boolean; layout: CoverLayout; mockupCount: number; layoutMatchesCount: boolean;
  };
}
```

### 3.16 Resolved rule objects (improvement #5 — non-persisted)

```typescript
/**
 * Resolved* — the Rule Engine's OUTPUT after context resolution.
 * NOT persisted, NOT serialized. Lifecycle:
 *   1. CREATED during Phase 6 RESOLVE (RE §3): each matched Rule's ConditionNode is
 *      evaluated to a boolean; each RuleTarget/NumericExpression is resolved to concrete
 *      values against the read-only EvaluationContext.
 *   2. CONSUMED by candidate filtering (RE §10) and the RuleTrace (RE §15).
 *   3. DISCARDED at end of evaluation. A subsequent run recreates them deterministically.
 */
export interface ResolvedCondition {
  readonly source: ConditionNode;
  readonly matched: boolean;                    // final boolean result
}
export interface ResolvedTarget {
  readonly source: RuleTarget;
  readonly resolved: readonly string[];         // concrete target ids/tokens after resolution
}
export interface ResolvedEffect {
  readonly type: RuleEffectType;
  readonly targets: readonly ResolvedTarget[];
  readonly limit: number | null;                // NumericExpression evaluated, if present
}
export interface ResolvedRule {
  readonly ruleId: RuleId;
  readonly priority: RulePriorityClass;
  readonly domain: RuleDomain;
  readonly condition: ResolvedCondition;
  readonly effect: ResolvedEffect;
  readonly appliedResultCode: string | null;    // RULE_* if this rule produced a failure
}
```

### 3.17 PromptMetadata (improvement #11 — new)

```typescript
/** Reproducibility metadata attached to any generated prompt artifact
 *  (OutputA/OutputB/MainCover/Group). Enables reproducible prompt generation:
 *  identical inputs + identical versions ⇒ identical promptChecksum. */
export interface PromptMetadata {
  templateVersion: SemVer;                      // version of the prompt template used
  moduleVersions: Readonly<Record<PromptModuleType, SemVer>>; // version of each composed module (§10)
  generatedAt: IsoTimestamp;                    // excluded from promptChecksum
  generatorVersion: SemVer;                     // Prompt Engine version
  promptChecksum: Sha256;                        // deterministic checksum of the composed prompt
}
```

### 3.18 SessionFingerprint (improvement #12 — new)

```typescript
/** Uniquely identifies an entire photoshoot session by its GENERATION-AFFECTING
 *  selections. Timestamps, names, ordering, and UI-only state are EXCLUDED, so two
 *  sessions with identical creative inputs share a fingerprint (idempotence, §2).
 *  `hash` is the canonical Sha256 over `components`. */
export interface SessionFingerprint {
  readonly hash: Sha256;
  readonly components: {
    readonly season: SeasonId;
    readonly audience: Audience;
    readonly productIds: readonly ProductId[];         // sorted lexicographically
    readonly colorIds: readonly ColorId[];             // sorted; includes `locked`
    readonly colorLocked: boolean;
    readonly requestedSceneCount: number;
    readonly sceneFingerprints: readonly Sha256[];     // sorted; each Scene.sceneFingerprint (§3.5)
    readonly artworkContentHashes: readonly Sha256[];  // sorted; each referenced Artwork.contentHash
    readonly ruleSetVersions: Readonly<Record<RuleSetId, SchemaVersion>>; // active rule-set versions
    readonly isDigitalProduct: boolean;
  };
}
```

### 3.19 Event model (improvement #16 — data contracts only)

```typescript
export enum DomainEventType {
  SceneCreated = 'scene_created', SceneUpdated = 'scene_updated',
  OutputGenerated = 'output_generated', ArtworkUploaded = 'artwork_uploaded',
  CoverGenerated = 'cover_generated', ValidationCompleted = 'validation_completed',
  ProjectSaved = 'project_saved',
}

/** Base contract. Events are append-only facts; no runtime/handler logic here. */
export interface DomainEvent {
  readonly eventId: EventId;
  readonly type: DomainEventType;
  readonly occurredAt: IsoTimestamp;
  readonly projectId: ProjectId;
  readonly sessionId?: SessionId;
  readonly emittedBy: EngineId;
}

export interface SceneCreatedEvent extends DomainEvent {
  readonly type: DomainEventType.SceneCreated;
  readonly sceneId: SceneId;
  readonly sceneFingerprint: Sha256;
}
export interface SceneUpdatedEvent extends DomainEvent {
  readonly type: DomainEventType.SceneUpdated;
  readonly sceneId: SceneId;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly fingerprintChanged: boolean;         // drives regeneration (§3.5)
}
export interface OutputGeneratedEvent extends DomainEvent {
  readonly type: DomainEventType.OutputGenerated;
  readonly sceneId: SceneId;
  readonly outputKind: 'A' | 'B';
  readonly outputId: OutputAId | OutputBId;
  readonly contentHash: Sha256;
}
export interface ArtworkUploadedEvent extends DomainEvent {
  readonly type: DomainEventType.ArtworkUploaded;
  readonly artworkId: ArtworkId;
  readonly contentHash: Sha256;
}
export interface CoverGeneratedEvent extends DomainEvent {
  readonly type: DomainEventType.CoverGenerated;
  readonly coverId: CoverId;
  readonly layout: CoverLayout;
  readonly coverHash: Sha256;
}
export interface ValidationCompletedEvent extends DomainEvent {
  readonly type: DomainEventType.ValidationCompleted;
  readonly validationResultId: ValidationResultId;
  readonly passed: boolean;
  readonly blockingCount: number;
}
export interface ProjectSavedEvent extends DomainEvent {
  readonly type: DomainEventType.ProjectSaved;
  readonly versionId: VersionId;
  readonly stateHash: Sha256;
}

export type AnyDomainEvent =
  | SceneCreatedEvent | SceneUpdatedEvent | OutputGeneratedEvent | ArtworkUploadedEvent
  | CoverGeneratedEvent | ValidationCompletedEvent | ProjectSavedEvent;
```

Events are **data contracts only** — no dispatcher, bus, or handler is specified here. They are append-only, timestamped facts (timestamps excluded from any hash) usable by persistence, the version manager, and future observability.

---

## 4. Relationships

```
Project (1) ───< sessions >─── PhotoshootSession (1..n)
Project (1) ───< versionHistory >─── VersionSnapshot (1..n)          [§13]
Project (1) ───< artworks >─── Artwork (0..n)                        [§4]

PhotoshootSession (1) ── season ──> Season (1)                       [§7]
PhotoshootSession (1) ── productIds ──> Product (1..n)               [§6]
PhotoshootSession (1) ── colorSelection ──> ColorSelection (1)       [§8]
PhotoshootSession (1) ───< scenes >─── Scene (1..n)                  [§9]
PhotoshootSession (1) ───< groups >─── Group (0..n)                  [§10,§12]
PhotoshootSession (1) ── cover ──> MainCover (0..1)                  [§5]
PhotoshootSession (1) ───< validationResults >─── ValidationResult (0..n) [§14]
PhotoshootSession (1) ── fingerprint ──> SessionFingerprint (1)      [derived, #12]

Scene (1) ── outputA ──> OutputA (1) ; ── outputB ──> OutputB (0..1) [§4]
Scene (1) ── dedupSignature ──> DedupSignature (1)                   [§8]
OutputB (1) ── sourceOutputAId ──> OutputA (1) [REQUIRED]            [§4]
OutputB (1) ── artworkId ──> Artwork (1) [REQUIRED]                  [§4]
OutputA/B/Cover/Group (1) ── promptMeta ──> PromptMetadata (0..1)    [#11]
MainCover (1) ───< sourceSaleImageIds >─── OutputA (1..n) ONLY       [§5]
Group (1) ───< sceneIds >─── Scene (1..n)                            [§10,§12]

RuleSet (1) ───< ruleIds >─── Rule (1..n)                            [§8]
Rule (1) ── effect.targets ──> RuleTarget (1..n)                     [#3]
Rule (1) ── effect.limit ──> NumericExpression (0..1)                [#4]
DomainEvent (n) ── projectId/sessionId ──> Project/Session           [#16]
```

MainCover→OutputA is restricted to `OutputAId[]`; assigning `OutputBId` is a compile error (ARCH §8.5). Season-priority rules may not reference the garment-color domain (RE §6).

---

## 5. Entity Invariants

Preserved from REVISED, plus new-field invariants.

**Project / Session / GenerationProgress / Scene / OutputA / OutputB / MainCover / ColorSelection / Group / ValidationResult / Artwork** — all REVISED invariants hold unchanged. Additionally:

- **Scene:** `sceneHash` = hash of all persisted scene fields; `sceneFingerprint` = hash of generation-affecting dimensions only; `sceneVersion` strictly increases on mutation. A change in `sceneFingerprint` ⇒ `outputA.status = Pending` and `outputB.status = Stale` (if present).
- **OutputA/B:** `contentHash` reflects overall content; `promptHash` reflects the prompt only; `renderHash` is `null` until rendered. **OutputB:** `sourceHash === source OutputA.contentHash` at generation time, else `status = Stale`.
- **MainCover:** `primaryProduct/Color/View` are the deterministic modes of the source Sale Images; `primaryAudience === session.audience`; `coverHash` covers sources+layout+metadata.
- **ValidationFailure:** `originEngine` always present; `ruleId`/`priorityClass`/`domain` are non-null for rule-derived failures and `null` for Validation-Engine predicates (`PA-PRED-*`, `COV-PRED-1`).
- **SessionFingerprint:** `hash` is a pure function of `components`; excludes all timestamps, names, ordering, and UI state. Two sessions with equal `components` have equal `hash`.
- **PromptMetadata:** `promptChecksum` excludes `generatedAt`; equal inputs+versions ⇒ equal checksum.
- **Rule:** `condition.field` and `ContextRef.ref` are valid `ContextFieldPath`s; `RuleEffect.limit` is a `NumericExpression` whose evaluation is deterministic; every `RuleTarget` is a valid union member; domain-isolation holds (Season ⇏ garment_color).

---

## 6. State Transition Models (preserved)

Session lifecycle, Output A, Output B, and Cover transitions are exactly as in the REVISED edition (ARCH §6; RE §8). Cover barrier uses `allOutputAReady === (outputAGenerated === totalScenes)`. Additionally, entering `Ready` emits `ProjectSaved`/`CoverGenerated` events (§3.19); a scene edit that changes `sceneFingerprint` emits `SceneUpdated` with `fingerprintChanged=true` and cascades regeneration.

---

## 7. Dependency Rules (preserved)

All REVISED dependency rules hold: Output B requires Output A + artwork; staleness via `sourceHash` mismatch; cover references Output A only; cover barrier via `allOutputAReady`; generation gate via passing `ValidationResult`; palette lock precedence (garment-color domain only).

---

## 8. Data Normalization Decisions (preserved + extended)

All REVISED normalization holds. Additions:
- **Metadata objects** (`PromptMetadata`) are embedded on their owning output (single-owner, not shared) — no separate normalized table, because a prompt-metadata record has no identity outside its output.
- **`SessionFingerprint`** is embedded on the session as a derived, recomputed value (never a shared entity).
- **Events** are an append-only stream external to the aggregate; they reference entities by ID and are never embedded.

---

## 16. Schema Versions & Migration

### 16.1 Current aggregate schema versions

| Aggregate | REVISED | FINAL | Reason |
|---|---|---|---|
| `project` | 1 | 1 | new fields are derived/optional (`SessionFingerprint`, output metadata) backfilled on load; no breaking shape change |
| `product` | 1 | 1 | `productHash?` optional |
| `season` | 1 | 1 | unchanged |
| `palette` | 1 | 1 | unchanged |
| `prompt_module` | 1 | 1 | unchanged |
| **`rule_set` / `rule`** | 2 | **3** | `RuleTarget`, `NumericExpression`, `ContextFieldPath`, expanded `RuleDomain` |

### 16.2 Migration REVISED → FINAL

- **`rule`/`rule_set` v2 → v3:**
  - `condition.field` (string) → `ContextFieldPath` (brand only; value unchanged).
  - `effect.targets`: each `string` → `{ kind:'literal', value }`; each `ContextRef` → `{ kind:'contextRef', ref }`; recognized pipeline tokens (`generation`, `cover_build`, …) → `{ kind:'symbolic', symbol }`; whole-dimension tokens → `{ kind:'dimension', dimension }`.
  - `effect.limit`: `number` → `{ kind:'literal', value }`; `ContextRef` → `{ kind:'contextRef', ref }`.
  - `domain`: re-classify product/palette/validation/artwork/prompt/session/export/group rules into the new domains where appropriate (additive; prior 8 domains still valid).
  - bump `schemaVersion` to 3; record `MigrationRecord`.
- **`scene` (within project):** backfill `sceneVersion=1`, `sceneHash`, `sceneFingerprint` on load.
- **`OutputA/B`, `MainCover`:** backfill `promptHash`, `renderHash=null`, `contentHash`(B)/`coverHash`, `promptMeta=null`; `OutputB.sourceHash = sourceContentHash`.
- **`ValidationFailure`:** backfill `originEngine`; `ruleId/priorityClass/domain = null` when unknown.
- **`session`:** compute `fingerprint` on load.
- All other aggregates migrate as identity.

Strategy is forward-only, non-destructive, lazy-on-read, additive-by-default (ARCH §10.8), identical to the REVISED policy.

---

## 17. Future-Compatibility Review (improvement #17)

Fields identified as likely to change, and the pre-emptive design that avoids breaking changes:

| Risk area | Future pressure | Pre-emptive design (now) |
|---|---|---|
| Rule targets | new target kinds (tag-match, expression) | `RuleTarget` discriminated union (#3) — grow the union, not `RuleEffect` |
| Dynamic values | richer arithmetic/functions | `NumericExpression` tree (#4) — add `function` names without shape change |
| Context paths | new context nodes | `ContextFieldPath` + declared grammar (#2) — validated centrally |
| Domains | new engines | `RuleDomain` string enum (#1) — additive |
| Product/Season catalogs | new products/seasons (§6/§15) | ID-referenced manifests, not enum-gated |
| Scene dimensions | new dimension | open vocabularies + `SceneDimension` enum — additive |
| Prompt reproducibility | new generator versions | `PromptMetadata` with `SemVer` versions (#11) |
| Metadata bags | ad-hoc extension | optional `metadata?: Record<string,string>` on `Product` (kept), extensible without schema breaks |
| Concurrency | multi-user later | `PersistenceMode` enum + `updatedAt`/`sceneVersion` optimistic markers already present |
| Hashing algorithm | algorithm rotation | `Sha256` brand isolates the choice; a future `HashRef { algo, digest }` can replace it behind the brand |

No field was removed; all changes are additive or brand-only, so saved v1/v2 data migrates forward (§16).

---

## 18. Stable Hashing Policy (improvement #13)

**Hash-owning objects and their inputs (canonical, key-sorted, timestamps excluded):**

| Hash | Owner | Inputs |
|---|---|---|
| `Product.productHash` | Product | manifest fields (views, printAreaProfile, audienceConstraints, defaultColors) |
| `Scene.sceneHash` | Scene | all persisted scene fields |
| `Scene.sceneFingerprint` | Scene | generation-affecting dimensions only |
| `DedupSignature.hash` | Scene/Dedup | (sceneTemplateId, poseId, cameraAngle, compositionId) |
| `OutputA.promptHash` / `OutputB.promptHash` / `MainCover.promptHash` | Prompt | composed prompt spec + resolved variables |
| `OutputA.contentHash` | Output | garment + color + view + prompt |
| `OutputB.contentHash` | Output | sourceHash + artworkId + prompt |
| `OutputB.sourceHash` | Output | pinned source `OutputA.contentHash` |
| `*.renderHash` | Render | rendered image bytes |
| `Artwork.contentHash` | Asset | PNG bytes |
| `MainCover.coverHash` | Cover | sourceSaleImageIds + layout + readMetadata (incl. primaries) |
| `PromptMetadata.promptChecksum` | Prompt | template + module versions + resolved prompt (excl. generatedAt) |
| `SessionFingerprint.hash` | Session | fingerprint components (§3.18) |
| `VersionSnapshot.stateHash` | Persistence | serialized project state |

**What changes when:**

- **Product changes** → `productHash`; any scene using it recomputes `sceneHash`/`sceneFingerprint`; dependent `OutputA.contentHash` → outputs `Pending`; `SessionFingerprint.hash` changes.
- **Scene changes (generation-affecting)** → `sceneFingerprint` (and `sceneHash`, `sceneVersion`); `OutputA.contentHash` → `Pending`; `OutputB` → `Stale`; `SessionFingerprint.hash` changes. Non-affecting change → only `sceneHash`/`sceneVersion`.
- **Prompt changes** → `promptHash` and `PromptMetadata.promptChecksum`; `contentHash` if the prompt is part of content; no scene/fingerprint change.
- **Artwork changes** → `Artwork.contentHash`; each dependent `OutputB.sourceHash` stays but `OutputB.contentHash` changes and status → `Stale`; `SessionFingerprint.hash` changes.
- **Cover changes** → `coverHash` (and `promptHash`/`renderHash`); never affects scenes or `SessionFingerprint` (cover derives from Sale Images, §5).

---

## 19. Immutable / Mutable / Derived / Computed (improvement #14)

Definitions: **Immutable** = set once, never changes. **Mutable** = editable by an engine. **Derived** = recomputed from other persisted fields. **Computed** = a hash/aggregate produced by an engine (a derived value that is also a hash/rollup).

| Entity | Immutable | Mutable | Derived | Computed |
|---|---|---|---|---|
| **Project** | id, createdAt, schemaVersion | name, updatedAt, isDigitalProduct, retention, ownerRef, currentVersionId | sessionOrder, versionOrder | — |
| **Session** | id, projectId, createdAt | name, updatedAt, season, audience, productIds, colorSelection, requestedSceneCount, status | sceneOrder, generationProgress.allOutputAReady | fingerprint |
| **Scene** | id, sessionId, templateId | 11 dimensions, view | (regeneration flags via fingerprint) | sceneVersion, sceneHash, sceneFingerprint, dedupSignature.hash |
| **OutputA** | id, sceneId, forbidden, generatedAt | garment, color, view, status, promptText, promptMeta | status(Pending on fingerprint change) | contentHash, promptHash, renderHash |
| **OutputB** | id, sceneId, sourceOutputAId, artworkId, onlyArtworkChanges, generatedAt | status, promptText, promptMeta | isStale, status(Stale) | contentHash, promptHash, renderHash, sourceHash, sourceContentHash |
| **Artwork** | id, projectId, uploadedAt, format | fileName | aspectRatio | contentHash |
| **MainCover** | id, sessionId, generatedAt | layout, status, promptText, promptMeta | readMetadata, primaries | coverHash, promptHash, renderHash |
| **Rule** | id | priority, domain, condition, effect, description | — | — |
| **ValidationResult** | id, sessionId, evaluatedAt | passed, checks, failures | passed(from failures) | — |
| **VersionSnapshot** | versionId, projectId, timestamp, parentVersionId, projectState, reason | — | — | stateHash |

---

## 20. Engine Ownership (improvement #15)

Each field belongs to exactly one **Owner Engine**; only the Creator writes it first, the Updater mutates it, Readers consume it, the Validator checks it. This prevents cross-engine coupling.

| Field group | Owner | Creator | Updater | Readers | Validator |
|---|---|---|---|---|---|
| Project identity/version (id, versionHistory) | Persistence | Persistence | Persistence/Version Mgr | all | Validation |
| Session selections (season, audience, productIds, colorSelection, requestedSceneCount) | Orchestrator | Orchestrator (UI intent) | Orchestrator | Rule, Scene, Palette, Cover | Validation |
| `SessionFingerprint` | Session/Orchestrator | Orchestrator | Orchestrator (on selection change) | Persistence, Dedup | Validation |
| Scene dimensions | Scene | Scene | Scene | Rule, Print-Area, Dedup, Prompt | Validation |
| `sceneVersion/sceneHash/sceneFingerprint` | Scene | Scene | Scene | Prompt, Persistence | Validation |
| `dedupSignature` | Dedup | Dedup | Dedup | Rule, Scene | Validation |
| `paletteColorId`, `garmentColorAllowed` | Palette | Scene (assign) / Palette (judge) | Palette | Rule | Validation |
| Print-area measurements (overlaps, sizeRatio, …) | Print-Area | Print-Area | Print-Area | Rule, Validation | Validation |
| OutputA/B fields + hashes | Prompt (prompt) / Render (renderHash) | Prompt | Prompt/Render | Cover, Export, Persistence | Validation |
| `promptMeta`, `PromptMetadata` | Prompt | Prompt | Prompt | Export, Persistence | Validation |
| `Artwork.*` | Asset | Asset (upload) | Asset | Prompt (Output B), Cover | Validation |
| `MainCover.*`, primaries, `coverHash` | Cover | Cover | Cover | Export, Persistence | Validation |
| `Group.*` | Group formation (Scene/Prompt) | Scene | Prompt (groupPromptText) | Export | Validation |
| `Rule/RuleSet/RuleTarget/NumericExpression` | Rule | (authored data) | (data library) | Rule | Validation (schema) |
| `EvaluationContext` (runtime) | Rule | Rule (per run) | — (read-only) | Rule | — |
| `Resolved*` (runtime) | Rule | Rule (Phase 6) | — | Rule (filter), Trace | — |
| `ValidationResult/Failure` (+ diagnostics) | Validation | Validation | Validation | Orchestrator, UI | — |
| `VersionSnapshot`, `stateHash` | Persistence | Persistence | — (immutable) | Version browser | — |
| `DomainEvent`s | emitting engine | emitting engine | — (append-only) | Persistence, observability | — |
| `GenerationProgress` | Orchestrator | Orchestrator | Orchestrator | Cover (barrier), UI | Validation |

---

## 21. Performance Considerations (improvement #18)

- **Normalized entities** (`ById` maps + `*Order`): O(1) lookup by ID, cheap structural sharing in version snapshots, and library updates that never rewrite sessions. Cost: explicit order arrays — justified for deterministic iteration.
- **Derived fields** (`allOutputAReady`, `garmentColorAllowed`, `isDuplicate`, cover primaries): precomputed to keep the Rule Engine's per-candidate evaluation O(1) instead of recomputing set membership each time (ARCH §10.5).
- **Cached values / hashes** (`sceneFingerprint`, `contentHash`, `SessionFingerprint.hash`): enable idempotent regeneration (skip work when a fingerprint is unchanged) and fast version diffing. Cost: recompute on mutation — bounded and local.
- **Runtime-only objects** (`EvaluationContext`, `Resolved*`): never serialized, recreated per evaluation — zero persistence cost, guaranteed determinism, no stale cache risk.
- **Persistent objects** (entities in §3.1–3.14, 3.17–3.18): the durable source of truth; kept minimal and additive so migrations stay cheap. Events (§3.19) are append-only and can be pruned independently of aggregates.

---

## 22. Missing-Requirement Resolutions Log (preserved)

[R1] Audience enum · [R2] scene vocabularies · [R3] cover layout mapping · [R4] print-area quantification · [R5] dedup signature · [R6] digital product status · [R7] validation severity · [R8] artwork constraints · [R9] Group entity · [R10] retention policy · [R11] single-user-local persistence. All unchanged from the REVISED edition; ARCH §9.12 left to acceptance testing.

---

## 23. Final Consistency Audit (improvement #19)

- **No conflicting types.** Every enum/interface has a single definition; `RuleOperator`, `RuleDomain`, `RulePriorityClass`, `ValidationSeverity` match RE exactly (RE §2, §12, §13, §14).
- **No duplicate concepts.** `sourceContentHash` retained as an alias of the new `sourceHash` (formalization, not duplication); `GarmentColor` (application) vs `Palette` (selection) are deliberately distinct, documented in §2.1.
- **No obsolete declarations.** All prior types remain valid; the only shape changes (`RuleEffect.targets/limit`, `RuleCondition.field`) are backward-mapped by the §16.2 migration; nothing is orphaned.
- **PRD coverage.** Products/seasons (§6/§7), outputs A/B (§4), cover (§5), rule engine (§8), scene dimensions (§9), prompt modules (§10), export (§12), save/version (§13), validation (§14), print area (§11) all have owning types.
- **Architecture coverage.** Every ARCH §3 engine has an `EngineId`, a `RuleDomain` (or is a measurement/predicate owner), and ownership rows (§20).
- **Rule Engine coverage.** `ContextFieldPath`, `RuleTarget`, `NumericExpression`, `ConditionNode`, `RuleDomain`, numeric/boolean/null operators, `Resolved*`, `EvaluationContext` all present and consistent with RE §5–§18.
- **Determinism preserved; Print Area highest; blocking halts; warnings never mutate.** (RE §1.3)

---

## 24. Compatibility Appendix (improvement #20)

### 24.1 Architecture compatibility checklist (`02_ARCHITECTURE.md`)
- [x] Layered ownership honored; each engine (ARCH §3) has `EngineId` + ownership rows (§20).
- [x] Data-driven libraries preserved (products/seasons/palettes/rule-sets by ID; §8).
- [x] Deterministic pipeline; runtime-only `EvaluationContext`/`Resolved*` never persisted (§3.15–3.16).
- [x] Schema-versioned persistence with forward-only migration (§16; ARCH §10.8).
- [x] Structural-shared version snapshots + `stateHash` (§3.14; ARCH §10.6).

### 24.2 Rule Engine compatibility checklist (`04_RULE_ENGINE_REVISED.md`)
- [x] `RuleOperator` (incl. numeric/presence), `RuleCondition.value` (bool/null), `ConditionNode`/`ConditionGroup` intact.
- [x] `ContextRef` + new `ContextFieldPath`; `RuleTarget`; `NumericExpression` (supersets prior `number | ContextRef`).
- [x] Expanded `RuleDomain`; domain isolation (Season ⇏ garment_color) invariant retained.
- [x] Cover barrier via `allOutputAReady`; dedup via `scene.isDuplicate`; no placeholders.
- [x] `Resolved*` output objects + lifecycle (§3.16) match RE §3/§10/§15.
- [x] `ValidationFailure` carries `code`+Arabic `message`+`severity`+ new diagnostics.

### 24.3 Future Scene Engine compatibility checklist
- [x] 11 §9 dimensions modeled; open vocabularies + `SceneDimension` enum for targeting.
- [x] `sceneFingerprint` drives deterministic regeneration; `dedupSignature` drives uniqueness.
- [x] `SceneCreated`/`SceneUpdated` events expose fingerprint changes.
- [x] Scene ownership fields assigned solely to Scene/Dedup/Palette engines (§20).

### 24.4 Prompt Engine compatibility checklist
- [x] 8 `PromptModuleType`s (§10) preserved; `Prompt` `RuleDomain` added.
- [x] `PromptMetadata` (templateVersion, moduleVersions, generatorVersion, promptChecksum) enables reproducibility.
- [x] `promptHash` on OutputA/B/Cover; hashing policy (§18) defines change propagation.
- [x] Group Prompt (§10) has `groupPromptMeta`.

### 24.5 Cover Engine compatibility checklist
- [x] Output-A-only sources enforced at type level; barrier via `allOutputAReady`.
- [x] `CoverLayout` [R3] mapping; `layoutMatchesCount` derived; `coverHash`.
- [x] Deterministic primaries (`primaryProduct/Color/View/Audience`) with documented tie-break (§3.9).
- [x] `CoverGenerated` event.

### 24.6 Validation Engine compatibility checklist
- [x] 8 `ValidationCheck`s; `ValidationSeverity` blocking/warning; blocking halts (§14).
- [x] Numeric print-area predicates `PA-PRED-*` + `COV-PRED-1` are Validation-owned, not rules (RE §7).
- [x] `ValidationFailure` diagnostics (`ruleId`, `priorityClass`, `domain`, `originEngine`) support debugging.
- [x] `ValidationCompleted` event with `passed` + `blockingCount`.

---

**Conclusion:** `03_DATA_MODELS_FINAL.md` removes no existing type, simplifies nothing, and adds the 20 required improvements. It is internally consistent and fully consistent with `01_PRD.md`, `02_ARCHITECTURE.md`, and `04_RULE_ENGINE_REVISED.md`. It is the **permanent authoritative domain-model source of truth** for all future engineering, superseding `03_DATA_MODELS.md` and `03_DATA_MODELS_REVISED.md`.

*Declarative type definitions only — no application logic, components, HTML, or CSS.*
