import { APP_CONFIG } from '../../config/app-config';
import {
  Audience,
  CoverLayout,
  DisplayMethod,
  ExportFormat,
  ExportScope,
  GarmentView,
  GroupBy,
  OutputStatus,
  PersistenceMode,
  ProductKind,
  PromptModuleType,
  RetentionPolicyKind,
  SeasonKind,
  SessionStatus,
  type Artwork,
  type Group,
  type PhotoshootSession,
  type Project,
  type Scene,
  type ValidationFailure,
} from '../../shared/domain-model';
import type {
  ExportEngineInput,
  ExportOperationalScope,
  ExportSourceSnapshot,
} from '../../shared/contracts/export-contracts';
import { exportFailure } from './failures';
import { canonicalGroups, canonicalScenes, canonicalSessions } from './ordering';
import {
  compareUtf8,
  exactKeys,
  hasOwn,
  inspectExportRuntimeValue,
  isDenseArray,
  isPlainRecord,
  sameStringSet,
  uniqueIds,
  validHash,
  validId,
  validIsoTimestamp,
  validPositiveInteger,
  validText,
} from './runtime';
import type { ExportPlanOmission, ExportPlanningFailureCode, ExportResolvedScope } from './types';

const SOURCE_KEYS = ['project', 'products', 'seasons', 'colors'] as const;
const PROJECT_KEYS = [
  'id',
  'schemaVersion',
  'name',
  'createdAt',
  'updatedAt',
  'sessions',
  'sessionOrder',
  'currentVersionId',
  'versionHistory',
  'versionOrder',
  'isDigitalProduct',
  'persistenceMode',
  'retention',
  'artworks',
] as const;
const SESSION_KEYS = [
  'id',
  'projectId',
  'name',
  'createdAt',
  'updatedAt',
  'season',
  'audience',
  'productIds',
  'colorSelection',
  'requestedSceneCount',
  'scenes',
  'sceneOrder',
  'groups',
  'cover',
  'status',
  'validationResultId',
  'validationResults',
  'dedupLedger',
  'generationProgress',
  'fingerprint',
] as const;
const SCENE_KEYS = [
  'id',
  'sessionId',
  'templateId',
  'productId',
  'locationId',
  'lightingId',
  'decorIds',
  'propIds',
  'cameraId',
  'compositionId',
  'poseId',
  'displayMethod',
  'paletteColorId',
  'seasonId',
  'printAreaRulesRef',
  'view',
  'dedupSignature',
  'outputA',
  'outputB',
  'sceneVersion',
  'sceneHash',
  'sceneFingerprint',
] as const;
const OUTPUT_A_KEYS = [
  'id',
  'sceneId',
  'garment',
  'color',
  'view',
  'status',
  'forbidden',
  'promptText',
  'contentHash',
  'generatedAt',
  'promptHash',
  'renderHash',
  'promptMeta',
] as const;
const OUTPUT_B_KEYS = [
  'id',
  'sceneId',
  'sourceOutputAId',
  'artworkId',
  'onlyArtworkChanges',
  'sourceContentHash',
  'status',
  'promptText',
  'generatedAt',
  'promptHash',
  'renderHash',
  'sourceHash',
  'contentHash',
  'promptMeta',
] as const;
const GROUP_KEYS = ['id', 'sessionId', 'groupBy', 'key', 'sceneIds', 'groupPromptText'] as const;
const COVER_KEYS = [
  'id',
  'sessionId',
  'sourceSaleImageIds',
  'layout',
  'readMetadata',
  'status',
  'promptText',
  'generatedAt',
  'promptHash',
  'renderHash',
  'coverHash',
  'promptMeta',
] as const;
const ARTWORK_KEYS = [
  'id',
  'projectId',
  'fileName',
  'pngAssetRef',
  'uploadedAt',
  'format',
  'hasTransparency',
  'widthPx',
  'heightPx',
  'aspectRatio',
  'contentHash',
] as const;
const VERSION_KEYS = [
  'versionId',
  'projectId',
  'timestamp',
  'parentVersionId',
  'projectState',
  'reason',
] as const;
const LIMIT_KEYS = [
  'maxPathSegment',
  'maxPathLength',
  'maxArtifactBytes',
  'maxJsonBytes',
  'maxJsonDepth',
  'maxZipEntries',
  'maxArchiveBytes',
  'maxUncompressedBytes',
  'maxCompressionRatio',
  'maxClipboardBytes',
] as const;
const PROMPT_META_KEYS = [
  'templateVersion',
  'moduleVersions',
  'generatedAt',
  'generatorVersion',
  'promptChecksum',
] as const;
const FORMAT_VALUES = new Set<unknown>([...Object.values(ExportFormat), 'clipboard', 'markdown']);
const STATUS_VALUES = new Set<unknown>(Object.values(OutputStatus));
const SESSION_STATUS_VALUES = new Set<unknown>(Object.values(SessionStatus));
const AUDIENCE_VALUES = new Set<unknown>(Object.values(Audience));
const VIEW_VALUES = new Set<unknown>(Object.values(GarmentView));
const DISPLAY_VALUES = new Set<unknown>(Object.values(DisplayMethod));
const GROUP_BY_VALUES = new Set<unknown>(Object.values(GroupBy));
const COVER_LAYOUT_VALUES = new Set<unknown>(Object.values(CoverLayout));
const PERSISTENCE_VALUES = new Set<unknown>(Object.values(PersistenceMode));
const RETENTION_VALUES = new Set<unknown>(Object.values(RetentionPolicyKind));
const PRODUCT_KIND_VALUES = new Set<unknown>(Object.values(ProductKind));
const SEASON_KIND_VALUES = new Set<unknown>(Object.values(SeasonKind));
const MODULE_TYPES = Object.values(PromptModuleType);
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;
const UNRESOLVED_VARIABLE = /\{\{[^{}]*\}\}/u;

function invalid(code: ExportPlanningFailureCode, field: string): readonly ValidationFailure[] {
  return [exportFailure(code, field)];
}

function validSemVer(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 && SEMVER.test(value);
}

function validNullableHash(value: unknown): boolean {
  return value === null || validHash(value);
}

function validNullableTimestamp(value: unknown): boolean {
  return value === null || validIsoTimestamp(value);
}

function validPromptMetadata(value: unknown, maximumEntries: number): boolean {
  if (value === null) return true;
  if (!isPlainRecord(value) || !exactKeys(value, PROMPT_META_KEYS)) return false;
  if (
    !validSemVer(value.templateVersion) ||
    !validIsoTimestamp(value.generatedAt) ||
    !validSemVer(value.generatorVersion) ||
    !validHash(value.promptChecksum) ||
    !isPlainRecord(value.moduleVersions)
  ) {
    return false;
  }
  const moduleVersions = value.moduleVersions;
  const keys = Object.keys(moduleVersions);
  return (
    keys.length <= maximumEntries &&
    keys.every((key) => MODULE_TYPES.includes(key as PromptModuleType)) &&
    keys.every((key) => validSemVer(moduleVersions[key]))
  );
}

function validateLimits(value: unknown): boolean {
  if (!isPlainRecord(value) || !exactKeys(value, LIMIT_KEYS)) return false;
  if (!LIMIT_KEYS.every((key) => validPositiveInteger(value[key], Number.MAX_SAFE_INTEGER))) {
    return false;
  }
  return (
    Number(value.maxJsonDepth) <= 72 &&
    Number(value.maxZipEntries) <= 20_000 &&
    Number(value.maxPathSegment) <= Number(value.maxPathLength) &&
    Number(value.maxArtifactBytes) <= Number(value.maxUncompressedBytes) &&
    Number(value.maxArchiveBytes) <= Number(value.maxUncompressedBytes) &&
    Number(value.maxCompressionRatio) > 1
  );
}

function validateVersions(value: unknown, maximumEntries: number): boolean {
  if (
    !isPlainRecord(value) ||
    !exactKeys(value, [
      'applicationVersion',
      'generatorVersion',
      'ruleSetVersions',
      'promptModuleVersions',
    ]) ||
    !validSemVer(value.applicationVersion) ||
    !validSemVer(value.generatorVersion) ||
    !isPlainRecord(value.ruleSetVersions) ||
    !isPlainRecord(value.promptModuleVersions)
  ) {
    return false;
  }
  if (
    Object.keys(value.ruleSetVersions).length > maximumEntries ||
    !Object.values(value.ruleSetVersions).every(
      (item) => Number.isSafeInteger(item) && Number(item) > 0,
    )
  ) {
    return false;
  }
  const promptModuleVersions = value.promptModuleVersions;
  const moduleKeys = Object.keys(promptModuleVersions);
  return (
    moduleKeys.length <= maximumEntries &&
    moduleKeys.every((key) => MODULE_TYPES.includes(key as PromptModuleType)) &&
    moduleKeys.every((key) => validSemVer(promptModuleVersions[key]))
  );
}

function validateScope(value: unknown): value is ExportOperationalScope {
  if (!isPlainRecord(value) || !validId(value.scopeDetail)) return false;
  if (value.scopeDetail === 'output_a') {
    return (
      exactKeys(value, ['baseScope', 'scopeDetail', 'sessionId', 'sceneId', 'outputAId']) &&
      value.baseScope === ExportScope.Output &&
      validId(value.sessionId) &&
      validId(value.sceneId) &&
      validId(value.outputAId)
    );
  }
  if (value.scopeDetail === 'output_b') {
    return (
      exactKeys(value, ['baseScope', 'scopeDetail', 'sessionId', 'sceneId', 'outputBId']) &&
      value.baseScope === ExportScope.Output &&
      validId(value.sessionId) &&
      validId(value.sceneId) &&
      validId(value.outputBId)
    );
  }
  if (value.scopeDetail === 'pair') {
    return (
      exactKeys(value, ['baseScope', 'scopeDetail', 'sessionId', 'sceneId']) &&
      value.baseScope === ExportScope.Output &&
      validId(value.sessionId) &&
      validId(value.sceneId)
    );
  }
  if (['group', 'group_a', 'group_b'].includes(value.scopeDetail)) {
    return (
      exactKeys(value, ['baseScope', 'scopeDetail', 'sessionId', 'groupId']) &&
      value.baseScope === ExportScope.Group &&
      validId(value.sessionId) &&
      validId(value.groupId)
    );
  }
  if (value.scopeDetail === 'cover') {
    return (
      exactKeys(value, ['baseScope', 'scopeDetail', 'sessionId', 'coverId']) &&
      value.baseScope === ExportScope.Cover &&
      validId(value.sessionId) &&
      validId(value.coverId)
    );
  }
  if (value.scopeDetail === 'session' || value.scopeDetail === 'execution_plan') {
    return (
      exactKeys(value, ['baseScope', 'scopeDetail', 'sessionId']) &&
      value.baseScope === ExportScope.Session &&
      validId(value.sessionId)
    );
  }
  if (value.scopeDetail === 'complete_project' || value.scopeDetail === 'all') {
    return exactKeys(value, ['baseScope', 'scopeDetail']) && value.baseScope === ExportScope.All;
  }
  if (value.scopeDetail === 'backup') {
    if (value.backupType === 'full_project') {
      return (
        exactKeys(value, ['baseScope', 'scopeDetail', 'backupType']) &&
        value.baseScope === ExportScope.All
      );
    }
    return (
      value.backupType === 'session' &&
      exactKeys(value, ['baseScope', 'scopeDetail', 'backupType', 'sessionId']) &&
      value.baseScope === ExportScope.All &&
      validId(value.sessionId)
    );
  }
  if (value.scopeDetail === 'version_snapshot') {
    return (
      exactKeys(value, ['baseScope', 'scopeDetail', 'versionId']) &&
      value.baseScope === ExportScope.All &&
      validId(value.versionId)
    );
  }
  if (value.scopeDetail === 'prompt_pack') {
    if (value.baseScope === ExportScope.All) {
      return exactKeys(value, ['baseScope', 'scopeDetail']);
    }
    return (
      value.baseScope === ExportScope.Session &&
      exactKeys(value, ['baseScope', 'scopeDetail', 'sessionId']) &&
      validId(value.sessionId)
    );
  }
  return false;
}

function validateFormats(value: unknown): boolean {
  return (
    isDenseArray(value, FORMAT_VALUES.size) &&
    value.length > 0 &&
    value.every((format) => FORMAT_VALUES.has(format)) &&
    new Set(value).size === value.length
  );
}

function validateOutputShape(value: unknown, kind: 'A' | 'B'): boolean {
  if (!isPlainRecord(value)) return value === null && kind === 'A';
  return kind === 'A' ? exactKeys(value, OUTPUT_A_KEYS) : exactKeys(value, OUTPUT_B_KEYS);
}

function validateArtworkMap(
  project: Record<string, unknown>,
  projectId: string,
  maximumEntries: number,
): readonly ValidationFailure[] {
  if (!isPlainRecord(project.artworks))
    return invalid('EXPORT_CORRUPT_001', 'source.project.artworks');
  const entries = Object.entries(project.artworks);
  if (entries.length > maximumEntries)
    return invalid('EXPORT_CORRUPT_001', 'source.project.artworks');
  for (const [key, value] of entries) {
    if (
      !isPlainRecord(value) ||
      !exactKeys(value, ARTWORK_KEYS, ['dpi']) ||
      value.id !== key ||
      value.projectId !== projectId
    ) {
      return invalid('EXPORT_CORRUPT_001', `source.project.artworks.${key}`);
    }
  }
  return [];
}

function validateVersionMap(
  project: Record<string, unknown>,
  projectId: string,
  maximumEntries: number,
): readonly ValidationFailure[] {
  if (!isPlainRecord(project.versionHistory) || !uniqueIds(project.versionOrder, maximumEntries)) {
    return invalid('EXPORT_NUM_001', 'source.project.versionOrder');
  }
  const keys = Object.keys(project.versionHistory);
  if (!sameStringSet(keys, project.versionOrder)) {
    return invalid('EXPORT_NUM_001', 'source.project.versionOrder');
  }
  for (const key of project.versionOrder) {
    const value = project.versionHistory[key];
    if (
      !isPlainRecord(value) ||
      !exactKeys(value, VERSION_KEYS, ['stateHash']) ||
      value.versionId !== key ||
      value.projectId !== projectId
    ) {
      return invalid('EXPORT_CORRUPT_001', `source.project.versionHistory.${key}`);
    }
  }
  return [];
}

function validateGroupMap(
  value: unknown,
  sessionId: string,
  maximumEntries: number,
  field: string,
): readonly ValidationFailure[] {
  if (!isPlainRecord(value) || Object.keys(value).length > maximumEntries) {
    return invalid('EXPORT_CORRUPT_001', field);
  }
  for (const [key, group] of Object.entries(value)) {
    if (
      !isPlainRecord(group) ||
      !exactKeys(group, GROUP_KEYS, ['groupPromptMeta']) ||
      group.id !== key ||
      group.sessionId !== sessionId ||
      !uniqueIds(group.sceneIds, maximumEntries)
    ) {
      return invalid('EXPORT_GROUP_001', `${field}.${key}`);
    }
  }
  return [];
}

function validateSceneMap(
  value: unknown,
  order: unknown,
  sessionId: string,
  maximumEntries: number,
  field: string,
): readonly ValidationFailure[] {
  if (!isPlainRecord(value) || !uniqueIds(order, maximumEntries)) {
    return invalid('EXPORT_NUM_001', `${field}Order`);
  }
  const keys = Object.keys(value);
  if (!sameStringSet(keys, order)) return invalid('EXPORT_NUM_001', `${field}Order`);
  for (const sceneId of order) {
    const scene = value[sceneId];
    if (isPlainRecord(scene) && !hasOwn(scene, 'outputA')) {
      return invalid('EXPORT_MISSINGA_001', `${field}.${sceneId}.outputA`);
    }
    if (
      !isPlainRecord(scene) ||
      !exactKeys(scene, SCENE_KEYS) ||
      scene.id !== sceneId ||
      scene.sessionId !== sessionId ||
      !validateOutputShape(scene.outputA, 'A') ||
      (scene.outputB !== null && !validateOutputShape(scene.outputB, 'B'))
    ) {
      return invalid('EXPORT_CORRUPT_001', `${field}.${sceneId}`);
    }
  }
  return [];
}

function validateSessionMap(
  project: Record<string, unknown>,
  maximumEntries: number,
): readonly ValidationFailure[] {
  if (!isPlainRecord(project.sessions) || !uniqueIds(project.sessionOrder, maximumEntries)) {
    return invalid('EXPORT_NUM_001', 'source.project.sessionOrder');
  }
  const keys = Object.keys(project.sessions);
  if (!sameStringSet(keys, project.sessionOrder)) {
    return invalid('EXPORT_NUM_001', 'source.project.sessionOrder');
  }
  for (const sessionId of project.sessionOrder) {
    const session = project.sessions[sessionId];
    const field = `source.project.sessions.${sessionId}`;
    if (
      !isPlainRecord(session) ||
      !exactKeys(session, SESSION_KEYS) ||
      session.id !== sessionId ||
      session.projectId !== project.id ||
      !isPlainRecord(session.scenes) ||
      !isPlainRecord(session.groups) ||
      !isPlainRecord(session.validationResults) ||
      !isPlainRecord(session.colorSelection) ||
      !isPlainRecord(session.generationProgress) ||
      !isPlainRecord(session.fingerprint) ||
      (session.cover !== null &&
        (!isPlainRecord(session.cover) || !exactKeys(session.cover, COVER_KEYS)))
    ) {
      return invalid('EXPORT_CORRUPT_001', field);
    }
    const sceneFailures = validateSceneMap(
      session.scenes,
      session.sceneOrder,
      sessionId,
      maximumEntries,
      `${field}.scenes`,
    );
    if (sceneFailures.length > 0) return sceneFailures;
    if (!uniqueIds(session.sceneOrder, maximumEntries)) {
      return invalid('EXPORT_NUM_001', `${field}.sceneOrder`);
    }
    if (
      !Number.isSafeInteger(session.requestedSceneCount) ||
      Number(session.requestedSceneCount) !== session.sceneOrder.length
    ) {
      return invalid('EXPORT_NUM_001', `${field}.requestedSceneCount`);
    }
    const groupFailures = validateGroupMap(
      session.groups,
      sessionId,
      maximumEntries,
      `${field}.groups`,
    );
    if (groupFailures.length > 0) return groupFailures;
  }
  return [];
}

function validateLibraries(
  source: Record<string, unknown>,
  maximumEntries: number,
): readonly ValidationFailure[] {
  for (const key of ['products', 'seasons', 'colors'] as const) {
    const value = source[key];
    if (!isDenseArray(value, maximumEntries)) {
      return invalid('EXPORT_CORRUPT_001', `source.${key}`);
    }
    const ids: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index];
      if (!isPlainRecord(item) || !validId(item.id)) {
        return invalid('EXPORT_CORRUPT_001', `source.${key}.${index}`);
      }
      ids.push(item.id);
    }
    if (new Set(ids).size !== ids.length) {
      return invalid('EXPORT_CORRUPT_001', `source.${key}`);
    }
  }
  return [];
}

function validateSourceStructure(
  value: unknown,
  maximumEntries: number,
): readonly ValidationFailure[] {
  if (!isPlainRecord(value) || !exactKeys(value, SOURCE_KEYS) || !isPlainRecord(value.project)) {
    return invalid('EXPORT_CORRUPT_001', 'source');
  }
  const project = value.project;
  if (
    !exactKeys(project, PROJECT_KEYS, ['ownerRef']) ||
    !validId(project.id) ||
    !validText(project.name, 1_000_000) ||
    !Number.isSafeInteger(project.schemaVersion) ||
    !validIsoTimestamp(project.createdAt) ||
    !validIsoTimestamp(project.updatedAt) ||
    typeof project.isDigitalProduct !== 'boolean' ||
    !PERSISTENCE_VALUES.has(project.persistenceMode) ||
    !isPlainRecord(project.retention) ||
    !RETENTION_VALUES.has(project.retention.kind)
  ) {
    return invalid('EXPORT_CORRUPT_001', 'source.project');
  }
  if (project.schemaVersion !== APP_CONFIG.schemaVersions.project) {
    return invalid('EXPORT_SCHEMA_001', 'source.project.schemaVersion');
  }
  const sessionFailures = validateSessionMap(project, maximumEntries);
  if (sessionFailures.length > 0) return sessionFailures;
  const versionFailures = validateVersionMap(project, project.id, maximumEntries);
  if (versionFailures.length > 0) return versionFailures;
  const artworkFailures = validateArtworkMap(project, project.id, maximumEntries);
  if (artworkFailures.length > 0) return artworkFailures;
  return validateLibraries(value, maximumEntries);
}

/** Full fail-closed boundary validation before any scope traversal. */
export function validateExportPlanningInput(
  input: ExportEngineInput,
): readonly ValidationFailure[] {
  let material: unknown;
  try {
    material = {
      source: input.source,
      scope: input.scope,
      formats: input.formats,
      createdAt: input.createdAt,
      versions: input.versions,
      limits: input.limits,
    };
  } catch {
    return invalid('EXPORT_CORRUPT_001', 'input');
  }
  const inspection = inspectExportRuntimeValue(material);
  if (inspection) return invalid('EXPORT_CORRUPT_001', `input.${inspection}`);
  if (!validateLimits(input.limits)) return invalid('EXPORT_CORRUPT_001', 'input.limits');
  if (!validateScope(input.scope)) return invalid('EXPORT_SCOPE_001', 'input.scope');
  if (!validateFormats(input.formats)) return invalid('EXPORT_SCOPE_001', 'input.formats');
  if (!validIsoTimestamp(input.createdAt)) {
    return invalid('EXPORT_CORRUPT_001', 'input.createdAt');
  }
  if (!validateVersions(input.versions, input.limits.maxZipEntries)) {
    return invalid('EXPORT_CORRUPT_001', 'input.versions');
  }
  return validateSourceStructure(input.source, input.limits.maxZipEntries);
}

export interface ExportEligibility {
  readonly validOutputAIds: ReadonlySet<string>;
  readonly validOutputBIds: ReadonlySet<string>;
  readonly validGroupIds: ReadonlySet<string>;
  readonly validGroupPlanIds: ReadonlySet<string>;
  readonly validCoverIds: ReadonlySet<string>;
  readonly validArtworkIds: ReadonlySet<string>;
  readonly omissions: readonly ExportPlanOmission[];
  readonly issues: readonly ValidationFailure[];
  readonly restrictedGroupBlocked: boolean;
}

function outputAIssue(
  scene: Scene,
  maximumTextLength: number,
  maximumEntries: number,
): ExportPlanningFailureCode | null {
  const output = scene.outputA;
  if (!isPlainRecord(output)) return 'EXPORT_MISSINGA_001';
  if (
    !validId(output.id) ||
    output.sceneId !== scene.id ||
    !validText(output.garment, 1_000_000) ||
    !validId(output.color) ||
    !VIEW_VALUES.has(output.view) ||
    !STATUS_VALUES.has(output.status) ||
    !isDenseArray(output.forbidden, 4) ||
    output.forbidden.join('\u0000') !== 'artwork\u0000logo\u0000watermark\u0000typography' ||
    !validText(output.promptText, maximumTextLength, true) ||
    !validHash(output.contentHash) ||
    !validHash(output.promptHash) ||
    !validNullableHash(output.renderHash) ||
    !validNullableTimestamp(output.generatedAt) ||
    !validPromptMetadata(output.promptMeta, maximumEntries)
  ) {
    return 'EXPORT_CORRUPT_001';
  }
  if (
    output.status !== OutputStatus.Generated ||
    output.generatedAt === null ||
    output.promptText.length === 0
  ) {
    return 'EXPORT_MISSINGA_001';
  }
  return UNRESOLVED_VARIABLE.test(output.promptText) ? 'EXPORT_PROMPTVAR_001' : null;
}

function validArtworkMetadata(artwork: Artwork | undefined, projectId: string): boolean {
  return (
    artwork !== undefined &&
    artwork.projectId === projectId &&
    artwork.format === 'png' &&
    typeof artwork.hasTransparency === 'boolean' &&
    validPositiveInteger(artwork.widthPx, 100_000) &&
    validPositiveInteger(artwork.heightPx, 100_000) &&
    (artwork.dpi === undefined || validPositiveInteger(artwork.dpi, 100_000)) &&
    typeof artwork.aspectRatio === 'number' &&
    Number.isFinite(artwork.aspectRatio) &&
    artwork.aspectRatio > 0 &&
    validHash(artwork.contentHash) &&
    validIsoTimestamp(artwork.uploadedAt)
  );
}

function outputBIssue(
  project: Project,
  scene: Scene,
  validOutputA: boolean,
  maximumTextLength: number,
  maximumEntries: number,
): ExportPlanningFailureCode | null {
  const output = scene.outputB;
  if (!isPlainRecord(output)) return 'EXPORT_SCOPE_002';
  if (!isPlainRecord(scene.outputA)) return 'EXPORT_MISSINGA_001';
  if (!validOutputA) return 'EXPORT_MISSINGA_001';
  if (
    !validId(output.sourceOutputAId) ||
    output.sourceOutputAId !== scene.outputA.id ||
    output.sceneId !== scene.id
  ) {
    return 'EXPORT_LINK_001';
  }
  if (
    !validId(output.id) ||
    !validId(output.artworkId) ||
    output.onlyArtworkChanges !== true ||
    !STATUS_VALUES.has(output.status) ||
    !validText(output.promptText, maximumTextLength, true) ||
    !validHash(output.sourceContentHash) ||
    !validHash(output.promptHash) ||
    !validNullableHash(output.renderHash) ||
    !validHash(output.sourceHash) ||
    !validHash(output.contentHash) ||
    !validNullableTimestamp(output.generatedAt) ||
    !validPromptMetadata(output.promptMeta, maximumEntries)
  ) {
    return 'EXPORT_CORRUPT_001';
  }
  if (
    output.status === OutputStatus.Stale ||
    output.sourceContentHash !== scene.outputA.contentHash ||
    output.sourceHash !== scene.outputA.contentHash
  ) {
    return 'EXPORT_STALE_001';
  }
  if (
    output.status !== OutputStatus.Generated ||
    output.generatedAt === null ||
    output.promptText.length === 0
  ) {
    return 'EXPORT_SCOPE_002';
  }
  if (UNRESOLVED_VARIABLE.test(output.promptText)) return 'EXPORT_PROMPTVAR_001';
  return validArtworkMetadata(project.artworks[output.artworkId], project.id)
    ? null
    : 'EXPORT_PNG_001';
}

function groupMembershipValid(session: PhotoshootSession, group: Group): boolean {
  if (
    !GROUP_BY_VALUES.has(group.groupBy) ||
    !validId(group.key) ||
    group.sceneIds.length === 0 ||
    new Set(group.sceneIds).size !== group.sceneIds.length
  ) {
    return false;
  }
  return group.sceneIds.every((sceneId) => {
    const scene = session.scenes[sceneId];
    if (!scene) return false;
    if (group.groupBy === GroupBy.Product) return scene.productId === group.key;
    if (group.groupBy === GroupBy.Color) return scene.paletteColorId === group.key;
    return group.groupBy === GroupBy.View && scene.view === group.key;
  });
}

function groupPlanIssue(
  group: Group,
  maximumTextLength: number,
  maximumEntries: number,
): ExportPlanningFailureCode | null {
  if (group.groupPromptText === null || group.groupPromptText.length === 0) {
    return 'EXPORT_SCOPE_002';
  }
  if (!validText(group.groupPromptText, maximumTextLength)) return 'EXPORT_CORRUPT_001';
  if (UNRESOLVED_VARIABLE.test(group.groupPromptText)) return 'EXPORT_PROMPTVAR_001';
  return validPromptMetadata(group.groupPromptMeta ?? null, maximumEntries)
    ? null
    : 'EXPORT_CORRUPT_001';
}

function coverIssue(
  session: PhotoshootSession,
  validOutputAIds: ReadonlySet<string>,
  maximumTextLength: number,
  maximumEntries: number,
): ExportPlanningFailureCode | null {
  const cover = session.cover;
  if (!isPlainRecord(cover)) return 'EXPORT_SCOPE_002';
  if (
    cover.id.length === 0 ||
    cover.sessionId !== session.id ||
    !COVER_LAYOUT_VALUES.has(cover.layout) ||
    !STATUS_VALUES.has(cover.status) ||
    !validText(cover.promptText, maximumTextLength, true) ||
    !validHash(cover.promptHash) ||
    !validNullableHash(cover.renderHash) ||
    !validHash(cover.coverHash) ||
    !validNullableTimestamp(cover.generatedAt) ||
    !validPromptMetadata(cover.promptMeta, maximumEntries) ||
    !isPlainRecord(cover.readMetadata) ||
    !uniqueIds(cover.sourceSaleImageIds, maximumEntries)
  ) {
    return 'EXPORT_CORRUPT_001';
  }
  if (!session.generationProgress.allOutputAReady) return 'EXPORT_SCOPE_002';
  const outputBIds = new Set<string>(
    Object.values(session.scenes)
      .map((scene) => scene.outputB?.id)
      .filter((id): id is NonNullable<typeof id> => id !== undefined),
  );
  if (
    cover.sourceSaleImageIds.some(
      (sourceId) => outputBIds.has(sourceId) || !validOutputAIds.has(sourceId),
    )
  ) {
    return 'EXPORT_COVER_001';
  }
  const expectedOutputAIds = session.sceneOrder.flatMap((sceneId) => {
    const outputAId = session.scenes[sceneId]?.outputA.id;
    return outputAId !== undefined && validOutputAIds.has(outputAId) ? [outputAId] : [];
  });
  const actualOutputAIds = new Set<string>(cover.sourceSaleImageIds);
  if (
    cover.sourceSaleImageIds.length !== expectedOutputAIds.length ||
    expectedOutputAIds.some((outputAId) => !actualOutputAIds.has(outputAId))
  ) {
    return 'EXPORT_COVER_001';
  }
  if (
    cover.sourceSaleImageIds.length === 0 ||
    cover.readMetadata.mockupCount !== cover.sourceSaleImageIds.length
  ) {
    return 'EXPORT_COVERCOUNT_001';
  }
  if (
    cover.status !== OutputStatus.Generated ||
    cover.generatedAt === null ||
    cover.promptText.length === 0
  ) {
    return 'EXPORT_SCOPE_002';
  }
  return UNRESOLVED_VARIABLE.test(cover.promptText) ? 'EXPORT_PROMPTVAR_001' : null;
}

/** Determine independently valid artifacts and record every rejected artifact. */
export function evaluateExportEligibility(
  source: ExportSourceSnapshot,
  resolved: ExportResolvedScope,
  limits: ExportEngineInput['limits'],
): ExportEligibility {
  const project = source.project as Project;
  const validOutputAIds = new Set<string>();
  const validOutputBIds = new Set<string>();
  const validGroupIds = new Set<string>();
  const validGroupPlanIds = new Set<string>();
  const validCoverIds = new Set<string>();
  const validArtworkIds = new Set<string>();
  const omissions: ExportPlanOmission[] = [];
  const issues: ValidationFailure[] = [];
  const issueKeys = new Set<string>();
  const omissionKeys = new Set<string>();
  let restrictedGroupBlocked = false;

  const addIssue = (code: ExportPlanningFailureCode, field: string): ValidationFailure => {
    const key = `${code}\u0000${field}`;
    const failure = exportFailure(code, field);
    if (!issueKeys.has(key)) {
      issueKeys.add(key);
      issues.push(failure);
    }
    return failure;
  };
  const omit = (
    artifactKind: ExportPlanOmission['artifactKind'],
    entityId: string,
    code: ExportPlanningFailureCode,
    field: string,
  ): void => {
    addIssue(code, field);
    const key = `${artifactKind}\u0000${entityId}\u0000${code}\u0000${field}`;
    if (omissionKeys.has(key)) return;
    omissionKeys.add(key);
    omissions.push({ artifactKind, entityId, field, code });
  };

  for (const session of canonicalSessions(project, resolved.sessionIds)) {
    const groups = canonicalGroups(session, resolved.groupIds);
    for (const group of groups) {
      const field = `source.project.sessions.${session.id}.groups.${group.id}`;
      if (!groupMembershipValid(session, group)) {
        omit('group', group.id, 'EXPORT_GROUP_001', `${field}.sceneIds`);
        if (resolved.policy.groupPlans && resolved.baseScope !== ExportScope.Group) {
          omit('group_plan', group.id, 'EXPORT_GROUP_001', `${field}.groupPromptText`);
        }
        if (resolved.baseScope === ExportScope.Group) restrictedGroupBlocked = true;
        continue;
      }
      validGroupIds.add(group.id);
      if (resolved.policy.groupPlans) {
        const code = groupPlanIssue(group, limits.maxArtifactBytes, limits.maxZipEntries);
        if (code) omit('group_plan', group.id, code, `${field}.groupPromptText`);
        else validGroupPlanIds.add(group.id);
      }
    }

    const scenes = canonicalScenes(session, resolved.sceneIds);
    const needsA =
      resolved.policy.outputA ||
      resolved.policy.outputB ||
      resolved.policy.executionPlans ||
      resolved.policy.cover;
    if (needsA) {
      for (const scene of scenes) {
        const field = `source.project.sessions.${session.id}.scenes.${scene.id}.outputA`;
        const code = outputAIssue(scene, limits.maxArtifactBytes, limits.maxZipEntries);
        if (code) {
          if (resolved.policy.outputA || resolved.policy.executionPlans) {
            omit('output_a', `${scene.id}:output_a`, code, field);
          } else {
            addIssue(code, field);
          }
        } else {
          validOutputAIds.add(scene.outputA.id);
        }
      }
    }

    if (resolved.policy.outputB || resolved.policy.executionPlans) {
      for (const scene of scenes) {
        const entityId = isPlainRecord(scene.outputB) ? scene.outputB.id : `${scene.id}:output_b`;
        const field = `source.project.sessions.${session.id}.scenes.${scene.id}.outputB`;
        const code = outputBIssue(
          project,
          scene,
          isPlainRecord(scene.outputA) && validOutputAIds.has(scene.outputA.id),
          limits.maxArtifactBytes,
          limits.maxZipEntries,
        );
        if (code) {
          omit('output_b', entityId, code, field);
        } else if (isPlainRecord(scene.outputB)) {
          validOutputBIds.add(scene.outputB.id);
          validArtworkIds.add(scene.outputB.artworkId);
        }
      }
    }

    if (resolved.policy.cover) {
      const entityId = isPlainRecord(session.cover) ? session.cover.id : `${session.id}:cover`;
      const field = `source.project.sessions.${session.id}.cover`;
      const code = coverIssue(
        session,
        validOutputAIds,
        limits.maxArtifactBytes,
        limits.maxZipEntries,
      );
      if (code) omit('cover', entityId, code, field);
      else if (isPlainRecord(session.cover)) validCoverIds.add(session.cover.id);
    }

    if (
      resolved.policy.executionPlans &&
      !scenes.some((scene) => isPlainRecord(scene.outputA) && validOutputAIds.has(scene.outputA.id))
    ) {
      omit(
        'execution_plan',
        session.id,
        'EXPORT_MISSINGA_001',
        `source.project.sessions.${session.id}.sceneOrder`,
      );
    }
  }

  const productIds = new Set(source.products.map((product) => product.id));
  const seasonIds = new Set(source.seasons.map((season) => season.id));
  const colorIds = new Set(source.colors.map((color) => color.id));
  const missingProducts = new Set<string>();
  const missingSeasons = new Set<string>();
  const missingColors = new Set<string>();
  for (const session of canonicalSessions(project, resolved.sessionIds)) {
    for (const productId of session.productIds) {
      if (!productIds.has(productId)) missingProducts.add(productId);
    }
    if (!seasonIds.has(session.season)) missingSeasons.add(session.season);
    for (const colorId of session.colorSelection.colorIds) {
      if (!colorIds.has(colorId)) missingColors.add(colorId);
    }
    for (const scene of canonicalScenes(session, resolved.sceneIds)) {
      if (!productIds.has(scene.productId)) missingProducts.add(scene.productId);
      if (!seasonIds.has(scene.seasonId)) missingSeasons.add(scene.seasonId);
      if (!colorIds.has(scene.paletteColorId)) missingColors.add(scene.paletteColorId);
    }
  }
  for (const productId of [...missingProducts].sort(compareUtf8)) {
    omit('product_metadata', productId, 'EXPORT_CORRUPT_001', `source.products.${productId}`);
  }
  for (const seasonId of [...missingSeasons].sort(compareUtf8)) {
    omit('season_metadata', seasonId, 'EXPORT_CORRUPT_001', `source.seasons.${seasonId}`);
  }
  for (const colorId of [...missingColors].sort(compareUtf8)) {
    omit('color_metadata', colorId, 'EXPORT_CORRUPT_001', `source.colors.${colorId}`);
  }

  return {
    validOutputAIds,
    validOutputBIds,
    validGroupIds,
    validGroupPlanIds,
    validCoverIds,
    validArtworkIds,
    omissions,
    issues,
    restrictedGroupBlocked,
  };
}

export function validateSelectedLibraryShapes(source: ExportSourceSnapshot): boolean {
  return (
    source.products.every(
      (product) =>
        validId(product.id) &&
        PRODUCT_KIND_VALUES.has(product.kind) &&
        validText(product.name, 1_000_000) &&
        validText(product.type, 1_000_000) &&
        product.allowedViews.every((view) => VIEW_VALUES.has(view)),
    ) &&
    source.seasons.every(
      (season) =>
        validId(season.id) &&
        SEASON_KIND_VALUES.has(season.kind) &&
        validText(season.name, 1_000_000),
    ) &&
    source.colors.every(
      (color) =>
        validId(color.id) &&
        validText(color.name, 1_000_000) &&
        typeof color.hex === 'string' &&
        /^#[a-fA-F0-9]{6}$/u.test(color.hex),
    )
  );
}

export function validateSelectedDomainEnums(source: ExportSourceSnapshot): boolean {
  const project = source.project as Project;
  return canonicalSessions(project, project.sessionOrder).every(
    (session) =>
      SESSION_STATUS_VALUES.has(session.status) &&
      AUDIENCE_VALUES.has(session.audience) &&
      session.sceneOrder.every((sceneId) => {
        const scene = session.scenes[sceneId]!;
        return DISPLAY_VALUES.has(scene.displayMethod) && VIEW_VALUES.has(scene.view);
      }),
  );
}
