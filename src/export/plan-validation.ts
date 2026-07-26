import {
  Audience,
  CoverLayout,
  DisplayMethod,
  EngineId,
  ExportScope,
  GarmentView,
  GroupBy,
  OutputStatus,
  PersistenceMode,
  ProductKind,
  RetentionPolicyKind,
  RuleDomain,
  RulePriorityClass,
  SeasonKind,
  SessionStatus,
  ValidationCheck,
  ValidationSeverity,
  type ValidationFailure,
} from '../shared/domain-model';
import type { ExportPlan } from '../shared/contracts/export-planning';
import { ERROR_BY_CODE } from '../shared/errors';
import { isPlainRecord } from './runtime';

const SCOPE_DETAILS = new Set([
  'output_a',
  'output_b',
  'pair',
  'group',
  'group_a',
  'group_b',
  'cover',
  'session',
  'execution_plan',
  'complete_project',
  'backup',
  'version_snapshot',
  'prompt_pack',
  'all',
]);
const ORDERED_KINDS = new Set([
  'project',
  'session',
  'group',
  'scene',
  'output_a',
  'output_b',
  'execution_plan',
  'cover',
  'version_snapshot',
]);
const OMISSION_KINDS = new Set([
  'output_a',
  'output_b',
  'group',
  'group_plan',
  'execution_plan',
  'cover',
  'artwork_metadata',
  'product_metadata',
  'season_metadata',
  'color_metadata',
]);
const VERSION_REASONS = new Set(['generated', 'manual_save', 'duplicate']);
const OUTPUT_A_FORBIDDEN = ['artwork', 'logo', 'watermark', 'typography'];

function enumStrings(value: Readonly<Record<string, string>>): ReadonlySet<string> {
  return new Set(Object.values(value));
}

const AUDIENCES = enumStrings(Audience);
const COVER_LAYOUTS = enumStrings(CoverLayout);
const DISPLAY_METHODS = enumStrings(DisplayMethod);
const ENGINE_IDS = enumStrings(EngineId);
const EXPORT_SCOPES = enumStrings(ExportScope);
const GARMENT_VIEWS = enumStrings(GarmentView);
const GROUP_BY_VALUES = enumStrings(GroupBy);
const OUTPUT_STATUSES = enumStrings(OutputStatus);
const PERSISTENCE_MODES = enumStrings(PersistenceMode);
const PRODUCT_KINDS = enumStrings(ProductKind);
const RETENTION_KINDS = enumStrings(RetentionPolicyKind);
const RULE_DOMAINS = enumStrings(RuleDomain);
const SEASON_KINDS = enumStrings(SeasonKind);
const SESSION_STATUSES = enumStrings(SessionStatus);
const VALIDATION_CHECKS = enumStrings(ValidationCheck);
const VALIDATION_SEVERITIES = enumStrings(ValidationSeverity);
const PRIORITY_CLASSES = new Set<number>([
  RulePriorityClass.PrintArea,
  RulePriorityClass.AudienceSafety,
  RulePriorityClass.Season,
  RulePriorityClass.PaletteLock,
  RulePriorityClass.SceneAesthetic,
]);

function exactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false;
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return (
    keys.every((key) => allowed.has(key)) &&
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function denseArray(
  value: unknown,
  maximumEntries: number,
  predicate: (item: unknown) => boolean,
): value is readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  if (value.length > maximumEntries || Object.keys(value).length !== value.length) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index) || !predicate(value[index])) {
      return false;
    }
  }
  return true;
}

function text(value: unknown, allowEmpty = true): value is string {
  return typeof value === 'string' && (allowEmpty || value.length > 0) && !value.includes('\u0000');
}

function id(value: unknown): value is string {
  if (!text(value, false) || value.length > 512) return false;
  if (value === '__proto__' || value === 'prototype' || value === 'constructor') return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return false;
  }
  return true;
}

function hash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && !Object.is(value, -0);
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function nullable<T>(
  value: unknown,
  predicate: (candidate: unknown) => candidate is T,
): value is T | null {
  return value === null || predicate(value);
}

function stringArray(
  value: unknown,
  maximumEntries: number,
  predicate: (candidate: unknown) => candidate is string = id,
): value is readonly string[] {
  return denseArray(value, maximumEntries, predicate);
}

function stringRecord(value: unknown, predicate: (candidate: unknown) => boolean): boolean {
  if (!isPlainRecord(value)) return false;
  return Object.entries(value).every(([key, item]) => id(key) && predicate(item));
}

function promptMetadata(value: unknown): boolean {
  return (
    value === null ||
    (exactRecord(value, [
      'templateVersion',
      'moduleVersions',
      'generatedAt',
      'generatorVersion',
      'promptChecksum',
    ]) &&
      text(value.templateVersion, false) &&
      stringRecord(value.moduleVersions, (item) => text(item, false)) &&
      timestamp(value.generatedAt) &&
      text(value.generatorVersion, false) &&
      hash(value.promptChecksum))
  );
}

function scopePolicy(value: unknown): boolean {
  if (
    !exactRecord(value, [
      'projectMetadata',
      'sessionMetadata',
      'sceneMetadata',
      'outputA',
      'outputB',
      'groupMetadata',
      'groupPlans',
      'executionPlans',
      'cover',
      'artworkMetadata',
      'validationResults',
      'versionMetadata',
      'backupResolutionOnly',
    ])
  ) {
    return false;
  }
  return Object.values(value).every((item) => typeof item === 'boolean');
}

function scope(value: unknown, maximumEntries: number): boolean {
  return (
    exactRecord(value, [
      'baseScope',
      'scopeDetail',
      'projectId',
      'sessionIds',
      'groupIds',
      'sceneIds',
      'outputAIds',
      'outputBIds',
      'coverIds',
      'versionIds',
      'policy',
    ]) &&
    typeof value.baseScope === 'string' &&
    EXPORT_SCOPES.has(value.baseScope) &&
    typeof value.scopeDetail === 'string' &&
    SCOPE_DETAILS.has(value.scopeDetail) &&
    id(value.projectId) &&
    stringArray(value.sessionIds, maximumEntries) &&
    stringArray(value.groupIds, maximumEntries) &&
    stringArray(value.sceneIds, maximumEntries) &&
    stringArray(value.outputAIds, maximumEntries) &&
    stringArray(value.outputBIds, maximumEntries) &&
    stringArray(value.coverIds, maximumEntries) &&
    stringArray(value.versionIds, maximumEntries) &&
    scopePolicy(value.policy)
  );
}

function numbering(value: unknown): boolean {
  if (
    !exactRecord(
      value,
      ['sessionId', 'sceneId', 'sceneNumber', 'outputAId', 'outputALabel'],
      ['outputBId', 'outputBLabel'],
    )
  ) {
    return false;
  }
  const hasOutputBId = Object.prototype.hasOwnProperty.call(value, 'outputBId');
  const hasOutputBLabel = Object.prototype.hasOwnProperty.call(value, 'outputBLabel');
  return (
    id(value.sessionId) &&
    id(value.sceneId) &&
    positiveInteger(value.sceneNumber) &&
    id(value.outputAId) &&
    typeof value.outputALabel === 'string' &&
    /^[1-9]\d*A$/u.test(value.outputALabel) &&
    hasOutputBId === hasOutputBLabel &&
    (!hasOutputBId ||
      (id(value.outputBId) &&
        typeof value.outputBLabel === 'string' &&
        /^[1-9]\d*B$/u.test(value.outputBLabel)))
  );
}

function groupNumbering(value: unknown): boolean {
  if (
    !exactRecord(
      value,
      [
        'sessionId',
        'groupId',
        'groupNumber',
        'groupSceneNumber',
        'sceneId',
        'sceneNumber',
        'outputAId',
        'outputALabel',
      ],
      ['outputBId', 'outputBLabel'],
    )
  ) {
    return false;
  }
  const hasOutputBId = Object.prototype.hasOwnProperty.call(value, 'outputBId');
  const hasOutputBLabel = Object.prototype.hasOwnProperty.call(value, 'outputBLabel');
  return (
    id(value.sessionId) &&
    id(value.groupId) &&
    positiveInteger(value.groupNumber) &&
    positiveInteger(value.groupSceneNumber) &&
    id(value.sceneId) &&
    positiveInteger(value.sceneNumber) &&
    id(value.outputAId) &&
    typeof value.outputALabel === 'string' &&
    /^[1-9]\d*\.[1-9]\d*-A$/u.test(value.outputALabel) &&
    hasOutputBId === hasOutputBLabel &&
    (!hasOutputBId ||
      (id(value.outputBId) &&
        typeof value.outputBLabel === 'string' &&
        /^[1-9]\d*\.[1-9]\d*-B$/u.test(value.outputBLabel)))
  );
}

function project(value: unknown, maximumEntries: number): boolean {
  if (
    !exactRecord(value, [
      'id',
      'schemaVersion',
      'name',
      'createdAt',
      'updatedAt',
      'sessionIds',
      'currentVersionId',
      'versionIds',
      'isDigitalProduct',
      'persistenceMode',
      'retention',
    ]) ||
    !exactRecord(value.retention, ['kind'], ['keepN', 'keepDays'])
  ) {
    return false;
  }
  return (
    id(value.id) &&
    positiveInteger(value.schemaVersion) &&
    text(value.name, false) &&
    timestamp(value.createdAt) &&
    timestamp(value.updatedAt) &&
    stringArray(value.sessionIds, maximumEntries) &&
    nullable(value.currentVersionId, id) &&
    stringArray(value.versionIds, maximumEntries) &&
    typeof value.isDigitalProduct === 'boolean' &&
    typeof value.persistenceMode === 'string' &&
    PERSISTENCE_MODES.has(value.persistenceMode) &&
    typeof value.retention.kind === 'string' &&
    RETENTION_KINDS.has(value.retention.kind) &&
    (value.retention.keepN === undefined || positiveInteger(value.retention.keepN)) &&
    (value.retention.keepDays === undefined || positiveInteger(value.retention.keepDays))
  );
}

function session(value: unknown, maximumEntries: number): boolean {
  if (
    !exactRecord(value, [
      'id',
      'projectId',
      'name',
      'createdAt',
      'updatedAt',
      'seasonId',
      'audience',
      'productIds',
      'colorSelection',
      'requestedSceneCount',
      'sceneIds',
      'status',
      'validationResultIds',
      'generationProgress',
      'fingerprint',
    ]) ||
    !exactRecord(value.colorSelection, ['colorIds', 'locked'], ['paletteId']) ||
    !exactRecord(value.generationProgress, [
      'totalScenes',
      'outputAGenerated',
      'outputBGenerated',
      'coverGenerated',
      'allOutputAReady',
    ]) ||
    !exactRecord(value.fingerprint, [
      'hash',
      'sceneFingerprints',
      'artworkContentHashes',
      'ruleSetVersions',
    ])
  ) {
    return false;
  }
  return (
    id(value.id) &&
    id(value.projectId) &&
    text(value.name, false) &&
    timestamp(value.createdAt) &&
    timestamp(value.updatedAt) &&
    id(value.seasonId) &&
    typeof value.audience === 'string' &&
    AUDIENCES.has(value.audience) &&
    stringArray(value.productIds, maximumEntries) &&
    stringArray(value.colorSelection.colorIds, maximumEntries) &&
    typeof value.colorSelection.locked === 'boolean' &&
    (value.colorSelection.paletteId === undefined || id(value.colorSelection.paletteId)) &&
    nonNegativeInteger(value.requestedSceneCount) &&
    stringArray(value.sceneIds, maximumEntries) &&
    typeof value.status === 'string' &&
    SESSION_STATUSES.has(value.status) &&
    stringArray(value.validationResultIds, maximumEntries) &&
    nonNegativeInteger(value.generationProgress.totalScenes) &&
    nonNegativeInteger(value.generationProgress.outputAGenerated) &&
    nonNegativeInteger(value.generationProgress.outputBGenerated) &&
    typeof value.generationProgress.coverGenerated === 'boolean' &&
    typeof value.generationProgress.allOutputAReady === 'boolean' &&
    hash(value.fingerprint.hash) &&
    stringArray(value.fingerprint.sceneFingerprints, maximumEntries, hash) &&
    stringArray(value.fingerprint.artworkContentHashes, maximumEntries, hash) &&
    stringRecord(value.fingerprint.ruleSetVersions, positiveInteger)
  );
}

function scene(value: unknown, maximumEntries: number): boolean {
  if (
    !exactRecord(value, [
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
      'sceneVersion',
      'sceneHash',
      'sceneFingerprint',
    ]) ||
    !exactRecord(value.dedupSignature, [
      'sceneTemplateId',
      'poseId',
      'cameraAngle',
      'compositionId',
      'hash',
    ])
  ) {
    return false;
  }
  return (
    id(value.id) &&
    id(value.sessionId) &&
    id(value.templateId) &&
    id(value.productId) &&
    id(value.locationId) &&
    id(value.lightingId) &&
    stringArray(value.decorIds, maximumEntries) &&
    stringArray(value.propIds, maximumEntries) &&
    id(value.cameraId) &&
    id(value.compositionId) &&
    id(value.poseId) &&
    typeof value.displayMethod === 'string' &&
    DISPLAY_METHODS.has(value.displayMethod) &&
    id(value.paletteColorId) &&
    id(value.seasonId) &&
    id(value.printAreaRulesRef) &&
    typeof value.view === 'string' &&
    GARMENT_VIEWS.has(value.view) &&
    id(value.dedupSignature.sceneTemplateId) &&
    id(value.dedupSignature.poseId) &&
    text(value.dedupSignature.cameraAngle, false) &&
    id(value.dedupSignature.compositionId) &&
    text(value.dedupSignature.hash, false) &&
    positiveInteger(value.sceneVersion) &&
    hash(value.sceneHash) &&
    hash(value.sceneFingerprint)
  );
}

function outputA(value: unknown, maximumEntries: number): boolean {
  return (
    exactRecord(value, [
      'id',
      'sessionId',
      'sceneId',
      'sceneNumber',
      'label',
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
    ]) &&
    id(value.id) &&
    id(value.sessionId) &&
    id(value.sceneId) &&
    positiveInteger(value.sceneNumber) &&
    typeof value.label === 'string' &&
    /^[1-9]\d*A$/u.test(value.label) &&
    text(value.garment, false) &&
    id(value.color) &&
    typeof value.view === 'string' &&
    GARMENT_VIEWS.has(value.view) &&
    typeof value.status === 'string' &&
    OUTPUT_STATUSES.has(value.status) &&
    denseArray(value.forbidden, maximumEntries, (item) => typeof item === 'string') &&
    value.forbidden.length === OUTPUT_A_FORBIDDEN.length &&
    value.forbidden.every((item, index) => item === OUTPUT_A_FORBIDDEN[index]) &&
    text(value.promptText) &&
    hash(value.contentHash) &&
    nullable(value.generatedAt, timestamp) &&
    hash(value.promptHash) &&
    nullable(value.renderHash, hash) &&
    promptMetadata(value.promptMeta)
  );
}

function outputB(value: unknown): boolean {
  return (
    exactRecord(value, [
      'id',
      'sessionId',
      'sceneId',
      'sceneNumber',
      'label',
      'sourceOutputAId',
      'sourceOutputALabel',
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
    ]) &&
    id(value.id) &&
    id(value.sessionId) &&
    id(value.sceneId) &&
    positiveInteger(value.sceneNumber) &&
    typeof value.label === 'string' &&
    /^[1-9]\d*B$/u.test(value.label) &&
    id(value.sourceOutputAId) &&
    typeof value.sourceOutputALabel === 'string' &&
    /^[1-9]\d*A$/u.test(value.sourceOutputALabel) &&
    id(value.artworkId) &&
    value.onlyArtworkChanges === true &&
    hash(value.sourceContentHash) &&
    typeof value.status === 'string' &&
    OUTPUT_STATUSES.has(value.status) &&
    text(value.promptText) &&
    nullable(value.generatedAt, timestamp) &&
    hash(value.promptHash) &&
    nullable(value.renderHash, hash) &&
    hash(value.sourceHash) &&
    hash(value.contentHash) &&
    promptMetadata(value.promptMeta)
  );
}

function group(value: unknown, maximumEntries: number): boolean {
  return (
    exactRecord(value, ['id', 'sessionId', 'groupNumber', 'groupBy', 'key', 'sceneIds']) &&
    id(value.id) &&
    id(value.sessionId) &&
    positiveInteger(value.groupNumber) &&
    typeof value.groupBy === 'string' &&
    GROUP_BY_VALUES.has(value.groupBy) &&
    id(value.key) &&
    stringArray(value.sceneIds, maximumEntries)
  );
}

function groupPlan(value: unknown): boolean {
  return (
    exactRecord(value, ['groupId', 'sessionId', 'groupNumber', 'promptText', 'promptMeta']) &&
    id(value.groupId) &&
    id(value.sessionId) &&
    positiveInteger(value.groupNumber) &&
    text(value.promptText) &&
    promptMetadata(value.promptMeta)
  );
}

function cover(value: unknown, maximumEntries: number): boolean {
  if (
    !exactRecord(value, [
      'id',
      'sessionId',
      'sourceOutputAIds',
      'sourceOutputALabels',
      'layout',
      'metadata',
      'status',
      'promptText',
      'generatedAt',
      'promptHash',
      'renderHash',
      'coverHash',
      'promptMeta',
    ]) ||
    !exactRecord(value.metadata, [
      'productIds',
      'colors',
      'mockupCount',
      'views',
      'seasonId',
      'digitalProductStatus',
      'primaryProduct',
      'primaryColor',
      'primaryView',
      'primaryAudience',
    ])
  ) {
    return false;
  }
  return (
    id(value.id) &&
    id(value.sessionId) &&
    stringArray(value.sourceOutputAIds, maximumEntries) &&
    stringArray(
      value.sourceOutputALabels,
      maximumEntries,
      (item): item is string => typeof item === 'string' && /^[1-9]\d*A$/u.test(item),
    ) &&
    typeof value.layout === 'string' &&
    COVER_LAYOUTS.has(value.layout) &&
    stringArray(value.metadata.productIds, maximumEntries) &&
    stringArray(value.metadata.colors, maximumEntries) &&
    nonNegativeInteger(value.metadata.mockupCount) &&
    stringArray(
      value.metadata.views,
      maximumEntries,
      (item): item is string => typeof item === 'string' && GARMENT_VIEWS.has(item),
    ) &&
    id(value.metadata.seasonId) &&
    typeof value.metadata.digitalProductStatus === 'boolean' &&
    id(value.metadata.primaryProduct) &&
    id(value.metadata.primaryColor) &&
    typeof value.metadata.primaryView === 'string' &&
    GARMENT_VIEWS.has(value.metadata.primaryView) &&
    typeof value.metadata.primaryAudience === 'string' &&
    AUDIENCES.has(value.metadata.primaryAudience) &&
    typeof value.status === 'string' &&
    OUTPUT_STATUSES.has(value.status) &&
    text(value.promptText) &&
    nullable(value.generatedAt, timestamp) &&
    hash(value.promptHash) &&
    nullable(value.renderHash, hash) &&
    hash(value.coverHash) &&
    promptMetadata(value.promptMeta)
  );
}

function artwork(value: unknown): boolean {
  return (
    exactRecord(
      value,
      [
        'id',
        'projectId',
        'uploadedAt',
        'format',
        'hasTransparency',
        'widthPx',
        'heightPx',
        'aspectRatio',
        'contentHash',
      ],
      ['dpi'],
    ) &&
    id(value.id) &&
    id(value.projectId) &&
    timestamp(value.uploadedAt) &&
    value.format === 'png' &&
    typeof value.hasTransparency === 'boolean' &&
    positiveInteger(value.widthPx) &&
    positiveInteger(value.heightPx) &&
    (value.dpi === undefined || positiveInteger(value.dpi)) &&
    finite(value.aspectRatio) &&
    value.aspectRatio > 0 &&
    hash(value.contentHash)
  );
}

function product(value: unknown, maximumEntries: number): boolean {
  return (
    exactRecord(
      value,
      ['id', 'schemaVersion', 'kind', 'name', 'type', 'allowedViews', 'defaultColors'],
      ['productHash'],
    ) &&
    id(value.id) &&
    positiveInteger(value.schemaVersion) &&
    typeof value.kind === 'string' &&
    PRODUCT_KINDS.has(value.kind) &&
    text(value.name, false) &&
    text(value.type, false) &&
    stringArray(
      value.allowedViews,
      maximumEntries,
      (item): item is string => typeof item === 'string' && GARMENT_VIEWS.has(item),
    ) &&
    stringArray(value.defaultColors, maximumEntries) &&
    (value.productHash === undefined || hash(value.productHash))
  );
}

function season(value: unknown): boolean {
  return (
    exactRecord(value, ['id', 'schemaVersion', 'kind', 'name']) &&
    id(value.id) &&
    positiveInteger(value.schemaVersion) &&
    typeof value.kind === 'string' &&
    SEASON_KINDS.has(value.kind) &&
    text(value.name, false)
  );
}

function color(value: unknown): boolean {
  return (
    exactRecord(value, ['id', 'name', 'hex']) &&
    id(value.id) &&
    text(value.name, false) &&
    typeof value.hex === 'string' &&
    /^#[a-fA-F0-9]{6}$/u.test(value.hex)
  );
}

function validationFailure(
  value: unknown,
  requireRegisteredExportCode: boolean,
): value is ValidationFailure {
  if (
    !exactRecord(value, [
      'check',
      'field',
      'code',
      'message',
      'severity',
      'ruleId',
      'priorityClass',
      'domain',
      'originEngine',
    ]) ||
    typeof value.check !== 'string' ||
    !VALIDATION_CHECKS.has(value.check) ||
    !text(value.field, false) ||
    !text(value.code, false) ||
    !text(value.message) ||
    typeof value.severity !== 'string' ||
    !VALIDATION_SEVERITIES.has(value.severity) ||
    !nullable(value.ruleId, id) ||
    !(
      value.priorityClass === null ||
      (typeof value.priorityClass === 'number' && PRIORITY_CLASSES.has(value.priorityClass))
    ) ||
    !(
      value.domain === null ||
      (typeof value.domain === 'string' && RULE_DOMAINS.has(value.domain))
    ) ||
    typeof value.originEngine !== 'string' ||
    !ENGINE_IDS.has(value.originEngine)
  ) {
    return false;
  }
  if (!requireRegisteredExportCode) return true;
  const registered = ERROR_BY_CODE[value.code];
  return registered?.namespace === 'EXPORT' && registered.originEngine === EngineId.Export;
}

function selectedValidationFailure(value: unknown): boolean {
  return (
    exactRecord(value, ['check', 'code', 'severity', 'priorityClass', 'domain', 'originEngine']) &&
    typeof value.check === 'string' &&
    VALIDATION_CHECKS.has(value.check) &&
    text(value.code, false) &&
    typeof value.severity === 'string' &&
    VALIDATION_SEVERITIES.has(value.severity) &&
    (value.priorityClass === null ||
      (typeof value.priorityClass === 'number' && PRIORITY_CLASSES.has(value.priorityClass))) &&
    (value.domain === null ||
      (typeof value.domain === 'string' && RULE_DOMAINS.has(value.domain))) &&
    typeof value.originEngine === 'string' &&
    ENGINE_IDS.has(value.originEngine)
  );
}

function validationResult(value: unknown, maximumEntries: number): boolean {
  return (
    exactRecord(value, ['id', 'sessionId', 'evaluatedAt', 'passed', 'checks', 'failures']) &&
    id(value.id) &&
    id(value.sessionId) &&
    timestamp(value.evaluatedAt) &&
    typeof value.passed === 'boolean' &&
    denseArray(
      value.checks,
      maximumEntries,
      (item) =>
        exactRecord(item, ['check', 'passed']) &&
        typeof item.check === 'string' &&
        VALIDATION_CHECKS.has(item.check) &&
        typeof item.passed === 'boolean',
    ) &&
    denseArray(value.failures, maximumEntries, selectedValidationFailure)
  );
}

function version(value: unknown): boolean {
  return (
    exactRecord(
      value,
      ['versionId', 'projectId', 'timestamp', 'parentVersionId', 'reason'],
      ['stateHash'],
    ) &&
    id(value.versionId) &&
    id(value.projectId) &&
    timestamp(value.timestamp) &&
    nullable(value.parentVersionId, id) &&
    typeof value.reason === 'string' &&
    VERSION_REASONS.has(value.reason) &&
    (value.stateHash === undefined || hash(value.stateHash))
  );
}

function executionPlan(value: unknown, maximumEntries: number): boolean {
  return (
    exactRecord(value, ['sessionId', 'phase1', 'phase2']) &&
    id(value.sessionId) &&
    denseArray(
      value.phase1,
      maximumEntries,
      (item) =>
        exactRecord(item, ['sceneId', 'outputAId', 'label']) &&
        id(item.sceneId) &&
        id(item.outputAId) &&
        typeof item.label === 'string' &&
        /^[1-9]\d*A$/u.test(item.label),
    ) &&
    denseArray(
      value.phase2,
      maximumEntries,
      (item) =>
        exactRecord(item, [
          'sceneId',
          'outputBId',
          'label',
          'sourceOutputAId',
          'sourceOutputALabel',
        ]) &&
        id(item.sceneId) &&
        id(item.outputBId) &&
        typeof item.label === 'string' &&
        /^[1-9]\d*B$/u.test(item.label) &&
        id(item.sourceOutputAId) &&
        typeof item.sourceOutputALabel === 'string' &&
        /^[1-9]\d*A$/u.test(item.sourceOutputALabel),
    )
  );
}

function ordered(value: unknown): boolean {
  return (
    exactRecord(value, ['kind', 'entityId'], ['sessionId', 'sceneId', 'label']) &&
    typeof value.kind === 'string' &&
    ORDERED_KINDS.has(value.kind) &&
    id(value.entityId) &&
    (value.sessionId === undefined || id(value.sessionId)) &&
    (value.sceneId === undefined || id(value.sceneId)) &&
    (value.label === undefined ||
      (typeof value.label === 'string' && /^[1-9]\d*[AB]$/u.test(value.label)))
  );
}

function omission(value: unknown): boolean {
  if (
    !exactRecord(value, ['artifactKind', 'entityId', 'field', 'code']) ||
    typeof value.artifactKind !== 'string' ||
    !OMISSION_KINDS.has(value.artifactKind) ||
    !id(value.entityId) ||
    !text(value.field, false) ||
    !text(value.code, false)
  ) {
    return false;
  }
  const registered = ERROR_BY_CODE[value.code];
  return registered?.namespace === 'EXPORT' && registered.originEngine === EngineId.Export;
}

function selection(value: unknown, maximumEntries: number): boolean {
  return (
    exactRecord(value, [
      'project',
      'sessions',
      'groups',
      'groupPlans',
      'scenes',
      'outputsA',
      'outputsB',
      'covers',
      'artworks',
      'products',
      'seasons',
      'colors',
      'validationResults',
      'versions',
      'executionPlans',
      'ordered',
    ]) &&
    (value.project === null || project(value.project, maximumEntries)) &&
    denseArray(value.sessions, maximumEntries, (item) => session(item, maximumEntries)) &&
    denseArray(value.groups, maximumEntries, (item) => group(item, maximumEntries)) &&
    denseArray(value.groupPlans, maximumEntries, groupPlan) &&
    denseArray(value.scenes, maximumEntries, (item) => scene(item, maximumEntries)) &&
    denseArray(value.outputsA, maximumEntries, (item) => outputA(item, maximumEntries)) &&
    denseArray(value.outputsB, maximumEntries, outputB) &&
    denseArray(value.covers, maximumEntries, (item) => cover(item, maximumEntries)) &&
    denseArray(value.artworks, maximumEntries, artwork) &&
    denseArray(value.products, maximumEntries, (item) => product(item, maximumEntries)) &&
    denseArray(value.seasons, maximumEntries, season) &&
    denseArray(value.colors, maximumEntries, color) &&
    denseArray(value.validationResults, maximumEntries, (item) =>
      validationResult(item, maximumEntries),
    ) &&
    denseArray(value.versions, maximumEntries, version) &&
    denseArray(value.executionPlans, maximumEntries, (item) =>
      executionPlan(item, maximumEntries),
    ) &&
    denseArray(value.ordered, maximumEntries, ordered)
  );
}

export function validFormatterPlan(value: unknown, maximumEntries: number): value is ExportPlan {
  return (
    exactRecord(value, [
      'scope',
      'numbering',
      'groupNumbering',
      'selection',
      'omissions',
      'issues',
      'partial',
    ]) &&
    scope(value.scope, maximumEntries) &&
    denseArray(value.numbering, maximumEntries, numbering) &&
    denseArray(value.groupNumbering, maximumEntries, groupNumbering) &&
    selection(value.selection, maximumEntries) &&
    denseArray(value.omissions, maximumEntries, omission) &&
    denseArray(value.issues, maximumEntries, (item) => validationFailure(item, true)) &&
    typeof value.partial === 'boolean'
  );
}

export function validPlannerFailures(
  value: unknown,
  maximumEntries: number,
): value is readonly ValidationFailure[] {
  return (
    denseArray(value, maximumEntries, (item) => validationFailure(item, true)) && value.length > 0
  );
}
