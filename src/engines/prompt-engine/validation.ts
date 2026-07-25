import {
  Audience,
  DisplayMethod,
  GarmentView,
  OutputStatus,
  ProductKind,
  SeasonKind,
  RuleDomain,
  CameraAngle,
} from '../../shared/domain-model';
import { validatePrintAreaProfileRuntime } from '../../shared/runtime-validation/print-area-profile';
import { canonicalizeCustomNotes, canonicalizeResolvedField } from './resolved-text';
import type { ComposeOutputAInput, ComposeOutputBInput, PromptEngineResult } from './types';
import { promptFailure } from './failures';

const MAX_ARRAY = 1_000;
const MAX_DEPTH = 64;
const MAX_TEXT = 8_192;
const DANGEROUS = new Set(['__proto__', 'prototype', 'constructor']);
const A_KEYS = new Set([
  'scene',
  'product',
  'season',
  'selectedColorIds',
  'resolved',
  'versions',
  'generatedAt',
  'constraints',
  'customNotes',
  'outputNumber',
]);
const B_KEYS = new Set([...A_KEYS, 'sourceImageAttached', 'artworkAttached', 'artwork']);
const RESOLVED_KEYS = new Set([
  'productDescription',
  'garmentColorName',
  'seasonDescription',
  'sceneDescription',
  'displayMethodDescription',
  'cameraCompositionDescription',
  'placementDescription',
  'viewDescription',
  'printAreaZone',
]);
const VERSION_KEYS = new Set(['templateVersion', 'generatorVersion', 'moduleVersion']);
const PRODUCT_KEYS = new Set([
  'id',
  'schemaVersion',
  'kind',
  'name',
  'type',
  'allowedViews',
  'printAreaProfile',
  'audienceConstraints',
  'defaultColors',
  'expandable',
  'metadata',
  'productHash',
]);
const AUDIENCE_KEYS = new Set(['forbidAdultModels', 'kidsOnly', 'allowedAudiences']);
const SEASON_KEYS = new Set([
  'id',
  'schemaVersion',
  'kind',
  'name',
  'sceneLibraryRef',
  'decorConstraints',
  'heroSceneConstraints',
  'forbiddenSeasonDecor',
]);
const SCENE_KEYS = new Set([
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
]);
const DEDUP_KEYS = new Set(['sceneTemplateId', 'poseId', 'cameraAngle', 'compositionId', 'hash']);
const OUTPUT_A_KEYS = new Set([
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
]);
const OUTPUT_B_KEYS = new Set([
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
]);
const ARTWORK_KEYS = new Set([
  'id',
  'projectId',
  'fileName',
  'pngAssetRef',
  'uploadedAt',
  'format',
  'hasTransparency',
  'widthPx',
  'heightPx',
  'dpi',
  'aspectRatio',
  'contentHash',
]);
const KINDS = new Set(Object.values(ProductKind));
const SEASONS = new Set(Object.values(SeasonKind));
const VIEWS = new Set(Object.values(GarmentView));
const DISPLAYS = new Set(Object.values(DisplayMethod));
const AUDIENCES = new Set(Object.values(Audience));
const STATUSES = new Set(Object.values(OutputStatus));

const CONSTRAINT_KEYS = new Set([
  'bucketKey',
  'domain',
  'target',
  'forbidden',
  'lockedTo',
  'limit',
  'required',
  'winningRuleIds',
]);
const RULE_DOMAINS = new Set(Object.values(RuleDomain));
const CAMERA_ANGLES = new Set(Object.values(CameraAngle));
type RecordValue = Record<string, unknown>;
type Inspect = 'unsafe' | 'limit' | null;
const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

function inspect(value: unknown, active = new WeakSet<object>(), depth = 0): Inspect {
  if (depth > MAX_DEPTH) return 'limit';
  if (value === null || typeof value !== 'object') return null;
  if (active.has(value)) return 'unsafe';
  active.add(value);
  try {
    const proto = Object.getPrototypeOf(value);
    if (Array.isArray(value) ? proto !== Array.prototype : proto !== Object.prototype)
      return 'unsafe';
    for (const key in value) if (!hasOwn(value, key)) return 'unsafe';
    if (Object.getOwnPropertySymbols(value).length) return 'unsafe';
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const names = Object.getOwnPropertyNames(value);
    if (names.some((key) => DANGEROUS.has(key))) return 'unsafe';
    if (names.some((key) => key !== 'length' && descriptors[key]?.enumerable !== true))
      return 'unsafe';
    if (names.some((key) => descriptors[key]?.get || descriptors[key]?.set)) return 'unsafe';
    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY) return 'limit';
      const keys = names.filter((key) => key !== 'length');
      if (keys.length !== value.length) return 'unsafe';
      for (let index = 0; index < value.length; index += 1)
        if (!hasOwn(value, index)) return 'unsafe';
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(value) && key === 'length') continue;
      if (!('value' in descriptor)) return 'unsafe';
      const nested = inspect(descriptor.value, active, depth + 1);
      if (nested) return nested;
    }
    return null;
  } catch {
    return 'unsafe';
  } finally {
    active.delete(value);
  }
}

function record(value: unknown): value is RecordValue {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
function exact(value: RecordValue, keys: ReadonlySet<string>): string | null {
  for (const key of Object.keys(value)) if (!keys.has(key)) return key;
  return null;
}
function required(value: RecordValue, keys: readonly string[]): string | null {
  for (const key of keys) if (!hasOwn(value, key)) return key;
  return null;
}
function text(value: unknown, empty = false): value is string {
  if (
    typeof value !== 'string' ||
    value.length > MAX_TEXT ||
    (!empty && value.trim().length === 0)
  ) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127
    ) {
      return false;
    }
  }
  return true;
}
function id(value: unknown): value is string {
  return text(value) && !DANGEROUS.has(value);
}
function dense(value: unknown): value is readonly unknown[] {
  return (
    Array.isArray(value) && value.length <= MAX_ARRAY && Object.keys(value).length === value.length
  );
}
function stringArray(value: unknown): value is readonly string[] {
  return dense(value) && value.every(id);
}
function semver(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u.test(value)
  );
}
function iso(value: unknown): value is string {
  return (
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
  );
}
function safeResolvedText(value: string): boolean {
  return value.length <= MAX_TEXT;
}

function validateConstraint(value: unknown, index: number): PromptEngineResult | null {
  const path = `constraints[${index}]`;
  if (!record(value)) return fail(path);
  const extra = exact(value, CONSTRAINT_KEYS);
  if (extra) return fail(`${path}.${extra}`);
  const miss = required(value, [...CONSTRAINT_KEYS]);
  if (miss) return fail(`${path}.${miss}`);
  if (!id(value.bucketKey) || !RULE_DOMAINS.has(value.domain as RuleDomain) || !text(value.target))
    return fail(path);
  if (typeof value.forbidden !== 'boolean' || typeof value.required !== 'boolean')
    return fail(path);
  if (value.lockedTo !== null && !stringArray(value.lockedTo)) return fail(`${path}.lockedTo`);
  if (
    value.limit !== null &&
    (typeof value.limit !== 'number' || !Number.isFinite(value.limit) || value.limit < 0)
  )
    return fail(`${path}.limit`);
  if (!stringArray(value.winningRuleIds)) return fail(`${path}.winningRuleIds`);
  return null;
}
function fail(field: string, code = 'PROMPT_INPUT_001'): PromptEngineResult {
  return { ok: false, failures: [promptFailure(code, field)] };
}

function validateProfile(value: unknown, path: string): PromptEngineResult | null {
  const issue = validatePrintAreaProfileRuntime(value, path);
  if (!issue) return null;
  return fail(
    issue.path,
    issue.kind === 'limit'
      ? 'PROMPT_INPUT_LIMIT'
      : issue.kind === 'unsafe'
        ? 'PROMPT_INPUT_UNSAFE'
        : 'PROMPT_INPUT_001',
  );
}
function validateProduct(value: unknown, path: string): PromptEngineResult | null {
  if (!record(value)) return fail(path, 'PROMPT_PRD_001');
  const extra = exact(value, PRODUCT_KEYS);
  if (extra) return fail(`${path}.${extra}`);
  const miss = required(value, [
    'id',
    'schemaVersion',
    'kind',
    'name',
    'type',
    'allowedViews',
    'printAreaProfile',
    'audienceConstraints',
    'defaultColors',
    'expandable',
  ]);
  if (miss) return fail(`${path}.${miss}`);
  if (
    !id(value.id) ||
    typeof value.schemaVersion !== 'number' ||
    !Number.isInteger(value.schemaVersion) ||
    value.schemaVersion < 1 ||
    !KINDS.has(value.kind as ProductKind) ||
    !text(value.name) ||
    !text(value.type) ||
    !dense(value.allowedViews) ||
    !(value.allowedViews as unknown[]).every((v) => VIEWS.has(v as GarmentView)) ||
    !stringArray(value.defaultColors) ||
    value.expandable !== true
  )
    return fail(path, 'PROMPT_PRD_001');
  const profile = validateProfile(value.printAreaProfile, `${path}.printAreaProfile`);
  if (profile) return profile;
  if (!record(value.audienceConstraints)) return fail(`${path}.audienceConstraints`);
  const ae = exact(value.audienceConstraints, AUDIENCE_KEYS);
  if (ae) return fail(`${path}.audienceConstraints.${ae}`);
  if (
    hasOwn(value.audienceConstraints, 'forbidAdultModels') &&
    typeof value.audienceConstraints.forbidAdultModels !== 'boolean'
  )
    return fail(`${path}.audienceConstraints.forbidAdultModels`);
  if (
    hasOwn(value.audienceConstraints, 'kidsOnly') &&
    typeof value.audienceConstraints.kidsOnly !== 'boolean'
  )
    return fail(`${path}.audienceConstraints.kidsOnly`);
  if (
    hasOwn(value.audienceConstraints, 'allowedAudiences') &&
    (!dense(value.audienceConstraints.allowedAudiences) ||
      !(value.audienceConstraints.allowedAudiences as unknown[]).every((v) =>
        AUDIENCES.has(v as Audience),
      ))
  )
    return fail(`${path}.audienceConstraints.allowedAudiences`);
  return null;
}
function validateOutputA(value: unknown, path: string): PromptEngineResult | null {
  if (!record(value)) return fail(path);
  const e = exact(value, OUTPUT_A_KEYS);
  if (e) return fail(`${path}.${e}`);
  const m = required(value, [...OUTPUT_A_KEYS]);
  if (m) return fail(`${path}.${m}`);
  if (
    !id(value.id) ||
    !id(value.sceneId) ||
    !text(value.garment, true) ||
    !id(value.color) ||
    !VIEWS.has(value.view as GarmentView) ||
    !STATUSES.has(value.status as OutputStatus) ||
    !dense(value.forbidden) ||
    JSON.stringify(value.forbidden) !== '["artwork","logo","watermark","typography"]' ||
    typeof value.promptText !== 'string' ||
    !id(value.contentHash) ||
    !(value.generatedAt === null || iso(value.generatedAt)) ||
    !id(value.promptHash) ||
    !(value.renderHash === null || id(value.renderHash)) ||
    value.promptMeta !== null
  )
    return fail(path);
  return null;
}
function validateOutputB(value: unknown, path: string): PromptEngineResult | null {
  if (value === null) return null;
  if (!record(value)) return fail(path);
  const e = exact(value, OUTPUT_B_KEYS);
  if (e) return fail(`${path}.${e}`);
  const m = required(value, [...OUTPUT_B_KEYS]);
  if (m) return fail(`${path}.${m}`);
  if (
    !id(value.id) ||
    !id(value.sceneId) ||
    !id(value.sourceOutputAId) ||
    !id(value.artworkId) ||
    value.onlyArtworkChanges !== true ||
    !id(value.sourceContentHash) ||
    !STATUSES.has(value.status as OutputStatus) ||
    typeof value.promptText !== 'string' ||
    !(value.generatedAt === null || iso(value.generatedAt)) ||
    !id(value.promptHash) ||
    !(value.renderHash === null || id(value.renderHash)) ||
    !id(value.sourceHash) ||
    !id(value.contentHash) ||
    value.promptMeta !== null
  )
    return fail(path);
  return null;
}
function validateScene(value: unknown, path: string): PromptEngineResult | null {
  if (!record(value)) return fail(path);
  const e = exact(value, SCENE_KEYS);
  if (e) return fail(`${path}.${e}`);
  const m = required(value, [...SCENE_KEYS]);
  if (m) return fail(`${path}.${m}`);
  for (const key of [
    'id',
    'sessionId',
    'templateId',
    'productId',
    'locationId',
    'lightingId',
    'cameraId',
    'compositionId',
    'poseId',
    'paletteColorId',
    'seasonId',
    'printAreaRulesRef',
    'sceneHash',
    'sceneFingerprint',
  ])
    if (!id(value[key])) return fail(`${path}.${key}`);
  if (
    !stringArray(value.decorIds) ||
    !stringArray(value.propIds) ||
    !DISPLAYS.has(value.displayMethod as DisplayMethod) ||
    !VIEWS.has(value.view as GarmentView) ||
    typeof value.sceneVersion !== 'number' ||
    !Number.isInteger(value.sceneVersion) ||
    value.sceneVersion < 1
  )
    return fail(path);
  if (!record(value.dedupSignature)) return fail(`${path}.dedupSignature`);
  const dedupExtra = exact(value.dedupSignature, DEDUP_KEYS);
  if (dedupExtra) return fail(`${path}.dedupSignature.${dedupExtra}`);
  const dedupMissing = required(value.dedupSignature, [...DEDUP_KEYS]);
  if (dedupMissing) return fail(`${path}.dedupSignature.${dedupMissing}`);
  if (
    !id(value.dedupSignature.sceneTemplateId) ||
    !id(value.dedupSignature.poseId) ||
    !CAMERA_ANGLES.has(value.dedupSignature.cameraAngle as CameraAngle) ||
    !id(value.dedupSignature.compositionId) ||
    !id(value.dedupSignature.hash)
  )
    return fail(`${path}.dedupSignature`);
  const a = validateOutputA(value.outputA, `${path}.outputA`);
  if (a) return a;
  const b = validateOutputB(value.outputB, `${path}.outputB`);
  if (b) return b;
  return null;
}
function validateSeason(value: unknown, path: string): PromptEngineResult | null {
  if (!record(value)) return fail(path);
  const e = exact(value, SEASON_KEYS);
  if (e) return fail(`${path}.${e}`);
  const m = required(value, [...SEASON_KEYS]);
  if (m) return fail(`${path}.${m}`);
  if (
    !id(value.id) ||
    typeof value.schemaVersion !== 'number' ||
    !Number.isInteger(value.schemaVersion) ||
    value.schemaVersion < 1 ||
    !SEASONS.has(value.kind as SeasonKind) ||
    !text(value.name) ||
    !id(value.sceneLibraryRef) ||
    !stringArray(value.decorConstraints) ||
    !stringArray(value.heroSceneConstraints) ||
    !stringArray(value.forbiddenSeasonDecor)
  )
    return fail(path);
  return null;
}

function validateRelationships(
  input: ComposeOutputAInput | ComposeOutputBInput,
  mode: 'a' | 'b',
): PromptEngineResult | null {
  if (input.scene.productId !== input.product.id) return fail('scene.productId', 'PROMPT_PRD_001');
  if (input.scene.seasonId !== input.season.id) return fail('scene.seasonId');
  if (input.scene.printAreaRulesRef !== input.product.printAreaProfile.id)
    return fail('scene.printAreaRulesRef');
  if (!input.product.allowedViews.includes(input.scene.view))
    return fail('scene.view', 'PROMPT_VIEW_001');
  if (!input.selectedColorIds.includes(input.scene.paletteColorId))
    return fail('scene.paletteColorId', 'PROMPT_COLOR_001');

  const outputA = input.scene.outputA;
  if (outputA.sceneId !== input.scene.id) return fail('scene.outputA.sceneId');
  if (outputA.garment !== input.product.type) return fail('scene.outputA.garment');
  if (outputA.color !== input.scene.paletteColorId) return fail('scene.outputA.color');
  if (outputA.view !== input.scene.view) return fail('scene.outputA.view');

  if (mode === 'b') {
    const preview = input as ComposeOutputBInput;
    const outputB = preview.scene.outputB;
    if (!outputB) return fail('scene.outputB');
    if (outputB.sourceOutputAId !== outputA.id) return fail('scene.outputB.sourceOutputAId');
    if (outputB.sceneId !== input.scene.id) return fail('scene.outputB.sceneId');
    if (outputB.sourceHash !== outputA.contentHash) return fail('scene.outputB.sourceHash');
    if (outputB.sourceContentHash !== outputA.contentHash)
      return fail('scene.outputB.sourceContentHash');
    if (outputB.artworkId !== preview.artwork.id) return fail('scene.outputB.artworkId');
  }
  return null;
}

export function validatePromptInput(value: unknown, mode: 'a' | 'b'): PromptEngineResult | null {
  const shape = inspect(value);
  if (shape === 'unsafe') return fail('input', 'PROMPT_INPUT_UNSAFE');
  if (shape === 'limit') return fail('input', 'PROMPT_INPUT_LIMIT');
  if (!record(value)) return fail('input');
  const keys = mode === 'a' ? A_KEYS : B_KEYS;
  const e = exact(value, keys);
  if (e) return fail(`input.${e}`);
  const base = [
    'scene',
    'product',
    'season',
    'selectedColorIds',
    'resolved',
    'versions',
    'generatedAt',
    'outputNumber',
  ];
  const m = required(
    value,
    mode === 'a' ? base : [...base, 'sourceImageAttached', 'artworkAttached', 'artwork'],
  );
  if (m) return fail(`input.${m}`);
  const scene = validateScene(value.scene, 'scene');
  if (scene) return scene;
  const product = validateProduct(value.product, 'product');
  if (product) return product;
  const season = validateSeason(value.season, 'season');
  if (season) return season;
  if (
    !dense(value.selectedColorIds) ||
    (value.selectedColorIds as unknown[]).length === 0 ||
    !(value.selectedColorIds as unknown[]).every(id)
  )
    return fail('selectedColorIds');
  if (
    !record(value.resolved) ||
    exact(value.resolved, RESOLVED_KEYS) ||
    required(value.resolved, [...RESOLVED_KEYS])
  )
    return fail('resolved');
  for (const k of RESOLVED_KEYS) {
    if (!text(value.resolved[k])) return fail(`resolved.${k}`);
    if (!safeResolvedText(value.resolved[k] as string))
      return fail(`resolved.${k}`, 'PROMPT_INPUT_001');
    if (
      canonicalizeResolvedField(
        k as keyof ComposeOutputAInput['resolved'],
        value.resolved[k] as string,
      ) === null
    )
      return fail(`resolved.${k}`, 'PROMPT_INPUT_001');
  }
  if (
    !record(value.versions) ||
    exact(value.versions, VERSION_KEYS) ||
    required(value.versions, [...VERSION_KEYS]) ||
    !semver(value.versions.templateVersion) ||
    !semver(value.versions.generatorVersion) ||
    !semver(value.versions.moduleVersion)
  )
    return fail('versions', 'PROMPT_MOD_001');
  if (
    !iso(value.generatedAt) ||
    typeof value.outputNumber !== 'number' ||
    !Number.isInteger(value.outputNumber) ||
    value.outputNumber < 1
  )
    return fail('input');
  if (hasOwn(value, 'customNotes')) {
    if (
      !dense(value.customNotes) ||
      (value.customNotes as unknown[]).length > 50 ||
      !(value.customNotes as unknown[]).every((v) => text(v, true)) ||
      canonicalizeCustomNotes(value.customNotes as readonly string[]) === null
    )
      return fail('customNotes');
  }
  if (hasOwn(value, 'constraints')) {
    if (!dense(value.constraints)) return fail('constraints');
    const seen = new Set<string>();
    for (let index = 0; index < (value.constraints as unknown[]).length; index += 1) {
      const item = (value.constraints as unknown[])[index];
      const invalidConstraint = validateConstraint(item, index);
      if (invalidConstraint) return invalidConstraint;
      const bucketKey = (item as RecordValue).bucketKey as string;
      if (seen.has(bucketKey)) return fail(`constraints[${index}].bucketKey`);
      seen.add(bucketKey);
    }
  }
  if (mode === 'b') {
    const preview = value as unknown as ComposeOutputBInput;
    if (
      typeof preview.sourceImageAttached !== 'boolean' ||
      typeof preview.artworkAttached !== 'boolean'
    )
      return fail('input');
    if (!preview.sourceImageAttached) return fail('sourceImageAttached', 'PROMPT_SRC_001');
    if (!preview.artworkAttached) return fail('artworkAttached', 'PROMPT_PNG_001');
    if (
      !record(preview.artwork) ||
      exact(preview.artwork, ARTWORK_KEYS) ||
      required(preview.artwork, [
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
      ])
    )
      return fail('artwork', 'PROMPT_PNG_001');
    if (
      !id(preview.artwork.id) ||
      !id(preview.artwork.projectId) ||
      !text(preview.artwork.fileName) ||
      !safeResolvedText(preview.artwork.fileName) ||
      !id(preview.artwork.pngAssetRef) ||
      !iso(preview.artwork.uploadedAt) ||
      preview.artwork.format !== 'png' ||
      typeof preview.artwork.hasTransparency !== 'boolean' ||
      typeof preview.artwork.widthPx !== 'number' ||
      !Number.isInteger(preview.artwork.widthPx) ||
      preview.artwork.widthPx < 1 ||
      typeof preview.artwork.heightPx !== 'number' ||
      !Number.isInteger(preview.artwork.heightPx) ||
      preview.artwork.heightPx < 1 ||
      typeof preview.artwork.aspectRatio !== 'number' ||
      !Number.isFinite(preview.artwork.aspectRatio) ||
      preview.artwork.aspectRatio <= 0 ||
      (hasOwn(preview.artwork, 'dpi') &&
        (typeof preview.artwork.dpi !== 'number' ||
          !Number.isFinite(preview.artwork.dpi) ||
          preview.artwork.dpi <= 0)) ||
      !id(preview.artwork.contentHash)
    )
      return fail('artwork', 'PROMPT_PNG_001');
  }
  const relationshipFailure = validateRelationships(
    value as unknown as ComposeOutputAInput | ComposeOutputBInput,
    mode,
  );
  if (relationshipFailure) return relationshipFailure;
  return null;
}
