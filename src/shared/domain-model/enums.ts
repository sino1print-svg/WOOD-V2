/**
 * Closed enumerations — 03_DATA_MODELS_FINAL §2.1.
 * Values are transcribed exactly from the authoritative data model.
 */

export enum ProductKind {
  BellaCanvas3001 = 'bella_canvas_3001',
  ClassicTShirt = 'classic_tshirt',
  ComfortColors = 'comfort_colors',
  Oversized = 'oversized',
  Hoodie = 'hoodie',
  Crewneck = 'crewneck',
  Kids = 'kids',
  Tank = 'tank',
  Polo = 'polo',
  Raglan = 'raglan',
  ZipHoodie = 'zip_hoodie',
}

export enum SeasonKind {
  Halloween = 'halloween',
  Christmas = 'christmas',
  ValentinesDay = 'valentines_day',
  MothersDay = 'mothers_day',
  FathersDay = 'fathers_day',
  BackToSchool = 'back_to_school',
  Summer = 'summer',
  Fall = 'fall',
  Winter = 'winter',
  Teacher = 'teacher',
  MinimalStudio = 'minimal_studio',
}

export enum Audience {
  Kids = 'kids',
  Adult = 'adult',
  Unisex = 'unisex',
  Teen = 'teen',
  All = 'all',
}

export enum GarmentView {
  Front = 'front',
  Back = 'back',
  Side = 'side',
  FlatDetail = 'flat_detail',
}

export enum DisplayMethod {
  OnModel = 'on_model',
  FlatLay = 'flat_lay',
  Hanger = 'hanger',
  Folded = 'folded',
  GhostMannequin = 'ghost_mannequin',
  Hanging = 'hanging',
}

export enum CameraAngle {
  Eye = 'eye_level',
  High = 'high_angle',
  Low = 'low_angle',
  TopDown = 'top_down',
  ThreeQuarter = 'three_quarter',
  Straight = 'straight_on',
}

export enum SessionStatus {
  Draft = 'draft',
  Validating = 'validating',
  Blocked = 'blocked',
  Generating = 'generating',
  CoverBuild = 'cover_build',
  Ready = 'ready',
  Exported = 'exported',
}

export enum OutputStatus {
  Pending = 'pending',
  Generated = 'generated',
  Stale = 'stale',
}

export enum CoverLayout {
  Single = 'single',
  Duo = 'duo',
  Triptych = 'triptych',
  Grid2x2 = 'grid_2x2',
  Grid2x3 = 'grid_2x3',
  Grid3x3 = 'grid_3x3',
  Mosaic = 'mosaic',
}

export enum RuleEffectType {
  Forbid = 'forbid',
  Require = 'require',
  Lock = 'lock',
  Limit = 'limit',
}

export enum RuleOperator {
  Equals = 'eq',
  NotEquals = 'neq',
  In = 'in',
  NotIn = 'not_in',
  Includes = 'includes',
  Excludes = 'excludes',
  CountEquals = 'count_eq',
  CountGte = 'count_gte',
  CountLte = 'count_lte',
  NumberEquals = 'num_eq',
  NumberGte = 'num_gte',
  NumberLte = 'num_lte',
  NumberGt = 'num_gt',
  NumberLt = 'num_lt',
  Exists = 'exists',
  IsNull = 'is_null',
}

export enum RulePriorityClass {
  PrintArea = 1,
  AudienceSafety = 2,
  Season = 3,
  PaletteLock = 4,
  SceneAesthetic = 5,
}

export enum RuleDomain {
  PrintArea = 'print_area',
  Background = 'background',
  Output = 'output',
  Model = 'model',
  Decor = 'decor',
  GarmentColor = 'garment_color',
  Composition = 'composition',
  Cover = 'cover',
  Palette = 'palette',
  Product = 'product',
  Validation = 'validation',
  Artwork = 'artwork',
  Prompt = 'prompt',
  Session = 'session',
  Export = 'export',
  Group = 'group',
}

export enum EngineId {
  Orchestrator = 'orchestrator',
  Rule = 'rule',
  Scene = 'scene',
  Prompt = 'prompt',
  PrintArea = 'print_area',
  Cover = 'cover',
  Dedup = 'dedup',
  Palette = 'palette',
  Validation = 'validation',
  Export = 'export',
  Persistence = 'persistence',
  Asset = 'asset',
}

export enum SceneDimension {
  Product = 'product',
  Location = 'location',
  Lighting = 'lighting',
  Decor = 'decor',
  Props = 'props',
  Camera = 'camera',
  Composition = 'composition',
  Pose = 'pose',
  DisplayMethod = 'display_method',
  GarmentColor = 'garment_color',
  View = 'view',
  PrintAreaRules = 'print_area_rules',
  Season = 'season',
}

export enum SymbolicTarget {
  Generation = 'generation',
  CoverBuild = 'cover_build',
  CoverPublish = 'cover.publish',
  ArtworkUpload = 'artwork.upload',
  OutputBPublish = 'outputB.publish',
  OutputBInCover = 'outputB_in_cover',
  ReadableBackground = 'readable_background_text',
  CollageOutput = 'collage_output',
  SeasonalDecor = 'seasonal_decor',
  NonSelectedColors = 'non_selected_colors',
  SceneDedupSignature = 'scene.dedupSignature',
  PrintAreaTooSmall = 'print_area_too_small',
  PrintAreaCentered = 'print_area_centered',
  PrintAreaMinSize = 'print_area_min_size',
}

export enum PromptModuleType {
  Global = 'global',
  Product = 'product',
  Season = 'season',
  Scene = 'scene',
  OutputA = 'output_a',
  OutputB = 'output_b',
  Cover = 'cover',
  Group = 'group',
}

export enum ExportScope {
  Output = 'output',
  Group = 'group',
  Cover = 'cover',
  Session = 'session',
  All = 'all',
}

export enum ExportFormat {
  Txt = 'txt',
  Json = 'json',
  Zip = 'zip',
}

export enum GroupBy {
  Product = 'product',
  Color = 'color',
  View = 'view',
}

export enum ValidationCheck {
  Season = 'season',
  Audience = 'audience',
  Products = 'products',
  Colors = 'colors',
  SceneCount = 'scene_count',
  DuplicateScenes = 'duplicate_scenes',
  PrintRules = 'print_rules',
  CoverData = 'cover_data',
}

export enum ValidationSeverity {
  Blocking = 'blocking',
  Warning = 'warning',
}

export enum PersistenceMode {
  LocalSingleUser = 'local_single_user',
}

export enum RetentionPolicyKind {
  KeepAll = 'keep_all',
  KeepLastN = 'keep_last_n',
  KeepDays = 'keep_days',
}

export enum PrintAreaObstruction {
  Hands = 'hands',
  Hair = 'hair',
  Props = 'props',
  DeepFolds = 'deep_folds',
  Shadows = 'shadows',
}

export enum VocabularyKind {
  Location = 'location',
  Lighting = 'lighting',
  Decor = 'decor',
  Prop = 'prop',
  Composition = 'composition',
  Pose = 'pose',
  Camera = 'camera',
}

export enum DomainEventType {
  SceneCreated = 'scene_created',
  SceneUpdated = 'scene_updated',
  OutputGenerated = 'output_generated',
  ArtworkUploaded = 'artwork_uploaded',
  CoverGenerated = 'cover_generated',
  ValidationCompleted = 'validation_completed',
  ProjectSaved = 'project_saved',
  ExportStarted = 'export_started',
  ExportCompleted = 'export_completed',
  ExportFailed = 'export_failed',
  BackupCreated = 'backup_created',
  RestoreStarted = 'restore_started',
  RestoreCompleted = 'restore_completed',
  RestoreFailed = 'restore_failed',
  ClipboardCopyCompleted = 'clipboard_copy_completed',
  ClipboardCopyFailed = 'clipboard_copy_failed',
}
