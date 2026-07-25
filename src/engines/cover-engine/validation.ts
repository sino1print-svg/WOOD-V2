import {
  Audience,
  CoverLayout,
  DisplayMethod,
  GarmentView,
  OutputStatus,
  PromptModuleType,
  SeasonKind,
} from '../../shared/domain-model';
import { canonicalizePromptDataLine } from '../../shared/prompt-canonical';
import type { CoverEngineInput, CoverEngineResult } from './types';
import { coverFailureResult, type CoverFailureCode } from './failures';
import { deriveCoverLayout } from './layout';
import { validateCoverPromptModule } from './prompt-module';
import { exactKeys, hasOwn, inspectRuntimeInput, isDenseArray, isPlainRecord } from './runtime';
import {
  canonicalCoverFields,
  containsCoverPromptControlConflict,
  findCrossFieldSemanticConflict,
} from './semantic-conflict';

const INPUT_REQUIRED = [
  'coverId',
  'sessionId',
  'saleImages',
  'metadata',
  'project',
  'products',
  'season',
  'lockedColors',
  'promptModule',
  'allOutputAReady',
  'versions',
  'generatedAt',
] as const;
const INPUT_OPTIONAL = [
  'requestedLayout',
  'backgroundPreference',
  'sourceMutationRequested',
  'cachedCover',
] as const;
const SOURCE_KEYS = ['output', 'productId', 'displayMethod', 'sceneOrder'] as const;
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
const METADATA_KEYS = [
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
] as const;
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
const PROMPT_META_KEYS = [
  'templateVersion',
  'moduleVersions',
  'generatedAt',
  'generatorVersion',
  'promptChecksum',
] as const;
const VERSION_KEYS = ['templateVersion', 'generatorVersion', 'moduleVersion'] as const;
const PROJECT_KEYS = ['id', 'isDigitalProduct'] as const;

const LAYOUTS = new Set<unknown>(Object.values(CoverLayout));
const VIEWS = new Set<unknown>(Object.values(GarmentView));
const METHODS = new Set<unknown>(Object.values(DisplayMethod));
const AUDIENCES = new Set<unknown>(Object.values(Audience));
const SEASONS = new Set<unknown>(Object.values(SeasonKind));
const STATUSES = new Set<unknown>(Object.values(OutputStatus));
const MODULE_TYPES = Object.values(PromptModuleType);
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const HEX = /^#[a-fA-F0-9]{6}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const SAFE_PROMPT_LABEL = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} &'’().,+/-]*$/u;

function invalid(code: CoverFailureCode, field: string): CoverEngineResult {
  return coverFailureResult(code, field);
}

function validId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512) return false;
  if (['__proto__', 'prototype', 'constructor'].includes(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return false;
  }
  return true;
}

function validLabel(value: unknown, allowMaterialCompound = false): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256) return false;
  const canonical = canonicalizePromptDataLine(value, 256);
  return (
    canonical === value &&
    SAFE_PROMPT_LABEL.test(value) &&
    !/["“”]/u.test(value) &&
    !containsCoverPromptControlConflict(value, { allowMaterialCompound })
  );
}

function validPromptIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 128 &&
    /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(value) &&
    canonicalizePromptDataLine(value, 128) === value &&
    !containsCoverPromptControlConflict(value)
  );
}

function validText(value: unknown, allowEmpty = false): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 1_000_000 &&
    (allowEmpty || value.length > 0) &&
    !value.includes('\u0000')
  );
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && SHA256.test(value);
}

function validIso(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_UTC.test(value)) return false;
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return false;
  const canonical = new Date(instant).toISOString();
  return value === canonical || `${value.slice(0, -1)}.000Z` === canonical;
}

function validVersion(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 && SEMVER.test(value);
}

function uniqueStrings(value: unknown, allowEmpty = false): value is readonly string[] {
  return (
    isDenseArray(value) &&
    (allowEmpty || value.length > 0) &&
    value.every(validId) &&
    new Set(value).size === value.length
  );
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item) => right.includes(item));
}

function validateVersions(value: unknown): boolean {
  if (!isPlainRecord(value) || exactKeys(value, VERSION_KEYS)) return false;
  return VERSION_KEYS.every((key) => validVersion(value[key]));
}

function validateModuleVersions(value: unknown): boolean {
  if (!isPlainRecord(value) || exactKeys(value, MODULE_TYPES)) return false;
  return MODULE_TYPES.every((key) => validVersion(value[key]));
}

function validatePromptMetadata(value: unknown): boolean {
  if (!isPlainRecord(value) || exactKeys(value, PROMPT_META_KEYS)) return false;
  return (
    validVersion(value.templateVersion) &&
    validateModuleVersions(value.moduleVersions) &&
    validIso(value.generatedAt) &&
    validVersion(value.generatorVersion) &&
    validHash(value.promptChecksum)
  );
}

function validateMetadataShape(value: unknown): value is Record<string, unknown> {
  if (!isPlainRecord(value) || exactKeys(value, METADATA_KEYS)) return false;
  return (
    uniqueStrings(value.productIds) &&
    uniqueStrings(value.colors) &&
    Number.isSafeInteger(value.mockupCount) &&
    Number(value.mockupCount) >= 1 &&
    Number(value.mockupCount) <= 1_000 &&
    isDenseArray(value.views) &&
    value.views.length > 0 &&
    value.views.every((item) => VIEWS.has(item)) &&
    new Set(value.views).size === value.views.length &&
    validId(value.seasonId) &&
    typeof value.digitalProductStatus === 'boolean' &&
    validId(value.primaryProduct) &&
    validId(value.primaryColor) &&
    VIEWS.has(value.primaryView) &&
    AUDIENCES.has(value.primaryAudience)
  );
}

function validateOutputA(value: unknown, field: string): CoverEngineResult | null {
  if (!isPlainRecord(value)) return invalid('COVER_SRC_001', field);
  if (
    hasOwn(value, 'sourceOutputAId') ||
    hasOwn(value, 'artworkId') ||
    hasOwn(value, 'onlyArtworkChanges')
  ) {
    return invalid('COVER_SRC_001', field);
  }
  if (exactKeys(value, OUTPUT_A_KEYS)) return invalid('COVER_SRC_001', field);
  if (typeof value.id === 'string' && !validPromptIdentifier(value.id)) {
    return invalid('COVER_VAR_001', 'promptText');
  }
  if (
    !validPromptIdentifier(value.id) ||
    !validId(value.sceneId) ||
    !validLabel(value.garment) ||
    !validId(value.color) ||
    !VIEWS.has(value.view) ||
    !STATUSES.has(value.status) ||
    !isDenseArray(value.forbidden, 4) ||
    value.forbidden.length !== 4 ||
    value.forbidden[0] !== 'artwork' ||
    value.forbidden[1] !== 'logo' ||
    value.forbidden[2] !== 'watermark' ||
    value.forbidden[3] !== 'typography' ||
    !validText(value.promptText) ||
    !validHash(value.contentHash) ||
    !(value.generatedAt === null || validIso(value.generatedAt)) ||
    !validHash(value.promptHash) ||
    !(value.renderHash === null || validHash(value.renderHash)) ||
    !(value.promptMeta === null || validatePromptMetadata(value.promptMeta))
  ) {
    return invalid('COVER_SRC_001', field);
  }
  if (value.status !== OutputStatus.Generated)
    return invalid('COVER_BARRIER_001', `${field}.status`);
  return null;
}

function validateSource(value: unknown, index: number): CoverEngineResult | null {
  const field = `saleImages[${index}]`;
  if (!isPlainRecord(value) || exactKeys(value, SOURCE_KEYS)) {
    return invalid('COVER_SRC_001', field);
  }
  const output = validateOutputA(value.output, `${field}.output`);
  if (output) return output;
  if (
    !validId(value.productId) ||
    !METHODS.has(value.displayMethod) ||
    !Number.isSafeInteger(value.sceneOrder) ||
    Number(value.sceneOrder) < 1 ||
    Number(value.sceneOrder) > 1_000_000
  ) {
    return invalid('COVER_META_001', field);
  }
  return null;
}

function validateProductManifests(value: unknown): boolean {
  if (!isDenseArray(value) || value.length < 1) return false;
  const ids = new Set<string>();
  for (const item of value) {
    if (!isPlainRecord(item) || exactKeys(item, ['id', 'name'])) return false;
    if (!validId(item.id) || !validLabel(item.name, true) || ids.has(item.id)) return false;
    ids.add(item.id);
  }
  return true;
}

function validateProjectManifest(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    !exactKeys(value, PROJECT_KEYS) &&
    validId(value.id) &&
    typeof value.isDigitalProduct === 'boolean'
  );
}

function validateSeasonManifest(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    !exactKeys(value, ['id', 'name', 'kind']) &&
    validId(value.id) &&
    validLabel(value.name) &&
    SEASONS.has(value.kind)
  );
}

function validateColors(value: unknown): boolean {
  if (!isDenseArray(value) || value.length < 1) return false;
  const ids = new Set<string>();
  for (const item of value) {
    if (!isPlainRecord(item) || exactKeys(item, ['id', 'name', 'hex'])) return false;
    if (
      !validId(item.id) ||
      !validLabel(item.name) ||
      typeof item.hex !== 'string' ||
      !HEX.test(item.hex) ||
      ids.has(item.id)
    ) {
      return false;
    }
    ids.add(item.id);
  }
  return true;
}

/**
 * Evaluates the canonical field set for both a per-field conflict (a single field
 * containing both a protected concept and a weakening state) and a cross-field
 * conflict (the concepts split across two otherwise-innocuous-looking fields — see
 * `findCrossFieldSemanticConflict` for the pure-signal restriction that keeps this
 * safe against false positives). Per-field checks run first, in canonical order, so
 * a single-field conflict is always attributed to that exact field; only once every
 * field individually passes is the cross-field combination evaluated.
 */
function semanticConflictField(input: CoverEngineInput): string | null {
  const fields = canonicalCoverFields(input);
  for (const field of fields) {
    const allowMaterialCompound = /^products\[\d+\]\.name$/u.test(field.path);
    if (containsCoverPromptControlConflict(field.value, { allowMaterialCompound }))
      return field.path;
  }
  return findCrossFieldSemanticConflict(fields);
}

function validateCachedCover(value: unknown): boolean {
  if (!isPlainRecord(value) || exactKeys(value, COVER_KEYS)) return false;
  return (
    validId(value.id) &&
    validId(value.sessionId) &&
    uniqueStrings(value.sourceSaleImageIds) &&
    LAYOUTS.has(value.layout) &&
    validateMetadataShape(value.readMetadata) &&
    STATUSES.has(value.status) &&
    validText(value.promptText) &&
    !(value.generatedAt !== null && !validIso(value.generatedAt)) &&
    validHash(value.promptHash) &&
    !(value.renderHash !== null && !validHash(value.renderHash)) &&
    validHash(value.coverHash) &&
    validatePromptMetadata(value.promptMeta)
  );
}

export function validateCoverInput(input: CoverEngineInput): CoverEngineResult | null {
  try {
    const inspected = inspectRuntimeInput(input);
    if (inspected)
      return invalid('COVER_META_001', inspected === 'limit' ? 'input.limit' : 'input');
    if (!isPlainRecord(input) || exactKeys(input, INPUT_REQUIRED, INPUT_OPTIONAL)) {
      return invalid('COVER_META_001', 'input');
    }
    if (!validId(input.coverId) || !validId(input.sessionId)) {
      return invalid('COVER_META_001', 'identity');
    }
    if (!validateVersions(input.versions) || !validIso(input.generatedAt)) {
      return invalid('COVER_META_001', 'versions');
    }
    if (!validateProjectManifest(input.project)) {
      return invalid('COVER_META_001', 'project');
    }
    const promptModuleIssue = validateCoverPromptModule(input.promptModule);
    if (promptModuleIssue) {
      return invalid(
        promptModuleIssue === 'template' ? 'COVER_VAR_001' : 'COVER_META_001',
        'promptModule',
      );
    }
    const semanticConflict = semanticConflictField(input);
    if (semanticConflict) return invalid('COVER_VAR_001', semanticConflict);
    if (typeof input.allOutputAReady !== 'boolean') {
      return invalid('COVER_META_001', 'allOutputAReady');
    }
    if (!input.allOutputAReady) return invalid('COVER_BARRIER_001', 'allOutputAReady');
    if (
      hasOwn(input, 'sourceMutationRequested') &&
      typeof input.sourceMutationRequested !== 'boolean'
    ) {
      return invalid('COVER_META_001', 'sourceMutationRequested');
    }
    if (input.sourceMutationRequested === true) {
      return invalid('COVER_LOCK_001', 'sourceMutationRequested');
    }
    if (
      hasOwn(input, 'backgroundPreference') &&
      input.backgroundPreference !== 'warm_neutral' &&
      input.backgroundPreference !== 'green'
    ) {
      return invalid('COVER_META_001', 'backgroundPreference');
    }
    if (input.backgroundPreference === 'green') {
      return invalid('COVER_GREENBG_001', 'backgroundPreference');
    }
    if (!isDenseArray(input.saleImages) || input.saleImages.length < 1) {
      return invalid('COVER_COUNT_001', 'saleImages');
    }
    for (let index = 0; index < input.saleImages.length; index += 1) {
      const issue = validateSource(input.saleImages[index], index);
      if (issue) return issue;
    }
    const outputIds = input.saleImages.map((item) => item.output.id);
    if (new Set(outputIds).size !== outputIds.length) {
      return invalid('COVER_DUP_001', 'saleImages');
    }
    if (!validateMetadataShape(input.metadata)) {
      return invalid('COVER_META_001', 'metadata');
    }
    if (input.metadata.digitalProductStatus !== input.project.isDigitalProduct) {
      return invalid('COVER_META_001', 'metadata.digitalProductStatus');
    }
    if (input.metadata.mockupCount !== input.saleImages.length) {
      return invalid('COVER_COUNT_001', 'metadata.mockupCount');
    }
    if (!validateProductManifests(input.products)) {
      return invalid('COVER_META_001', 'products');
    }
    if (!validateSeasonManifest(input.season) || input.season.id !== input.metadata.seasonId) {
      return invalid('COVER_META_001', 'season');
    }
    if (!validateColors(input.lockedColors)) {
      return invalid('COVER_COLOR_001', 'lockedColors');
    }
    const lockedIds = input.lockedColors.map((color) => color.id);
    if (!sameSet(input.metadata.colors, lockedIds)) {
      return invalid('COVER_COLOR_001', 'metadata.colors');
    }
    if (input.saleImages.some((source) => !lockedIds.includes(source.output.color))) {
      return invalid('COVER_COLOR_001', 'saleImages.output.color');
    }
    const productIds = [...new Set(input.saleImages.map((source) => source.productId))];
    const manifestIds = input.products.map((product) => product.id);
    if (
      !sameSet(input.metadata.productIds, productIds) ||
      productIds.some((id) => !manifestIds.includes(id))
    ) {
      return invalid('COVER_META_001', 'metadata.productIds');
    }
    const views = [...new Set(input.saleImages.map((source) => source.output.view))];
    if (!sameSet(input.metadata.views, views)) {
      return invalid('COVER_META_001', 'metadata.views');
    }
    if (hasOwn(input, 'requestedLayout') && !LAYOUTS.has(input.requestedLayout)) {
      return invalid('COVER_LAYOUT_001', 'requestedLayout');
    }
    const expectedLayout = deriveCoverLayout(input.saleImages.length).layout;
    if (input.requestedLayout !== undefined && input.requestedLayout !== expectedLayout) {
      return invalid('COVER_LAYOUT_001', 'requestedLayout');
    }
    if (hasOwn(input, 'cachedCover') && !validateCachedCover(input.cachedCover)) {
      return invalid('COVER_META_001', 'cachedCover');
    }
    return null;
  } catch {
    return invalid('COVER_META_001', 'input');
  }
}
