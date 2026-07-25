import {
  Audience,
  DisplayMethod,
  GarmentView,
  PrintAreaObstruction,
  ProductKind,
  RuleDomain,
} from '../../shared/domain-model';
import type { PrintAreaEngineInput, PrintAreaEngineResult } from './types';
import { validatePrintAreaProfileRuntime as validateSharedPrintAreaProfile } from '../../shared/runtime-validation/print-area-profile';
import { printAreaFailure } from './failures';

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const POSITIONS = new Set(['center_chest', 'full_front', 'left_chest', 'center_back']);
const OBSTRUCTIONS = new Set<unknown>(Object.values(PrintAreaObstruction));
const PRODUCT_KINDS = new Set<unknown>(Object.values(ProductKind));
const GARMENT_VIEWS = new Set<unknown>(Object.values(GarmentView));
const DISPLAY_METHODS = new Set<unknown>(Object.values(DisplayMethod));
const AUDIENCES = new Set<unknown>(Object.values(Audience));
const RULE_DOMAINS = new Set<unknown>(Object.values(RuleDomain));
const MAX_ARRAY = 1_000;
const MAX_DEPTH = 64;

const INPUT_REQUIRED = ['scene', 'product', 'profile', 'observation'] as const;

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
const PRODUCT_REQUIRED = [
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
] as const;
const AUDIENCE_KEYS = new Set(['forbidAdultModels', 'kidsOnly', 'allowedAudiences']);
const OBSERVATION_KEYS = new Set(['overlaps', 'sizeRatio', 'centeringOffset', 'shadowCoverage']);
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
const SCENE_REQUIRED = [...SCENE_KEYS] as readonly string[];
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

type InspectionFailure = 'unsafe' | 'limit' | null;
type RecordValue = Record<string, unknown>;

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isArrayIndex(key: string): boolean {
  if (key === '') return false;
  const numeric = Number(key);
  return (
    Number.isInteger(numeric) && numeric >= 0 && numeric < 4_294_967_295 && String(numeric) === key
  );
}

function hasApprovedPrototype(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return Array.isArray(value) ? prototype === Array.prototype : prototype === Object.prototype;
}

/**
 * Inspects runtime input without invoking getters. Only ordinary objects and
 * ordinary arrays are accepted. Accessors, symbols, cycles, sparse arrays,
 * inherited enumerable properties, non-index array properties and unsafe keys
 * are rejected.
 */
function inspectRuntimeShape(
  value: unknown,
  active = new WeakSet<object>(),
  depth = 0,
): InspectionFailure {
  if (depth > MAX_DEPTH) return 'limit';
  if (value === null || typeof value !== 'object') return null;
  if (active.has(value)) return 'unsafe';

  active.add(value);
  try {
    if (!hasApprovedPrototype(value)) return 'unsafe';

    for (const key in value) {
      if (!hasOwn(value, key)) return 'unsafe';
    }

    const symbols = Object.getOwnPropertySymbols(value);
    if (symbols.length > 0) return 'unsafe';

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const names = Object.getOwnPropertyNames(value);

    if (names.some((key) => DANGEROUS_KEYS.has(key))) return 'unsafe';
    if (names.some((key) => key !== 'length' && descriptors[key]?.enumerable !== true)) {
      return 'unsafe';
    }
    if (names.some((key) => descriptors[key]?.get || descriptors[key]?.set)) return 'unsafe';

    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY) return 'limit';
      const elementKeys = names.filter((key) => key !== 'length');
      if (elementKeys.some((key) => !isArrayIndex(key))) return 'unsafe';
      if (elementKeys.length !== value.length) return 'unsafe';
      for (let index = 0; index < value.length; index += 1) {
        if (!hasOwn(value, index)) return 'unsafe';
      }
    }

    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (key === 'length' && Array.isArray(value)) continue;
      if (!('value' in descriptor)) return 'unsafe';
      const nested = inspectRuntimeShape(descriptor.value, active, depth + 1);
      if (nested) return nested;
    }

    return null;
  } catch {
    return 'unsafe';
  } finally {
    active.delete(value);
  }
}

function isRecord(value: unknown): value is RecordValue {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactShape(value: RecordValue, allowed: ReadonlySet<string>): string | null {
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!allowed.has(key)) return key;
  }
  return null;
}

function ownsAll(value: RecordValue, keys: readonly string[]): string | null {
  for (const key of keys) {
    if (!hasOwn(value, key)) return key;
  }
  return null;
}

function validId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return false;
  }
  return !DANGEROUS_KEYS.has(value);
}

function validString(value: unknown, allowEmpty = false): value is string {
  return typeof value === 'string' && (allowEmpty || value.length > 0) && value.length <= 4_096;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && !Object.is(value, -0);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function isDenseBoundedArray(value: unknown): value is readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  if (value.length > MAX_ARRAY) return false;
  const ownKeys = Object.keys(value);
  if (ownKeys.length !== value.length) return false;
  return ownKeys.every((key) => isArrayIndex(key));
}

function invalid(code: string, field: string): PrintAreaEngineResult {
  return { ok: false, failures: [printAreaFailure(code, field)] };
}

function validateStringArray(value: unknown): boolean {
  return isDenseBoundedArray(value) && value.every((item) => validId(item));
}

function validateProfile(value: unknown, path: string): PrintAreaEngineResult | null {
  const issue = validateSharedPrintAreaProfile(value, path);
  if (!issue) return null;
  if (issue.kind === 'limit') return invalid('PA_INTERNAL_LIMIT', issue.path);
  if (issue.kind === 'unsafe') return invalid('PA_INTERNAL_CYCLE', issue.path);
  return invalid(
    issue.path.endsWith('.position') ? 'PA_INTERNAL_POSITION' : 'PA_INTERNAL_PROFILE',
    issue.path,
  );
}

function equivalentProfiles(left: RecordValue, right: RecordValue): boolean {
  const leftOverlaps = left.forbiddenOverlaps as readonly unknown[];
  const rightOverlaps = right.forbiddenOverlaps as readonly unknown[];
  return (
    left.id === right.id &&
    left.position === right.position &&
    left.minSizeRatio === right.minSizeRatio &&
    left.centeringTolerance === right.centeringTolerance &&
    left.centered === right.centered &&
    left.maxShadowCoverage === right.maxShadowCoverage &&
    leftOverlaps.length === rightOverlaps.length &&
    leftOverlaps.every((value, index) => value === rightOverlaps[index])
  );
}

function validateAudienceConstraints(value: unknown): boolean {
  if (!isRecord(value) || exactShape(value, AUDIENCE_KEYS)) return false;
  if (hasOwn(value, 'forbidAdultModels') && typeof value.forbidAdultModels !== 'boolean')
    return false;
  if (hasOwn(value, 'kidsOnly') && typeof value.kidsOnly !== 'boolean') return false;
  if (hasOwn(value, 'allowedAudiences')) {
    if (!isDenseBoundedArray(value.allowedAudiences)) return false;
    if (value.allowedAudiences.some((item) => !AUDIENCES.has(item))) return false;
  }
  return true;
}

function validateProduct(value: unknown): PrintAreaEngineResult | null {
  if (!isRecord(value)) return invalid('PA_INTERNAL_INPUT', 'product');
  const unknown = exactShape(value, PRODUCT_KEYS);
  if (unknown) return invalid('PA_INTERNAL_INPUT', `product.${unknown}`);
  const missing = ownsAll(value, PRODUCT_REQUIRED);
  if (missing) return invalid('PA_INTERNAL_INPUT', `product.${missing}`);

  if (!validId(value.id)) return invalid('PA_INTERNAL_INPUT', 'product.id');
  if (!positiveInteger(value.schemaVersion))
    return invalid('PA_INTERNAL_INPUT', 'product.schemaVersion');
  if (!PRODUCT_KINDS.has(value.kind)) return invalid('PA_INTERNAL_INPUT', 'product.kind');
  if (!validString(value.name) || !validString(value.type, true)) {
    return invalid('PA_INTERNAL_INPUT', 'product');
  }
  if (!isDenseBoundedArray(value.allowedViews) || value.allowedViews.length === 0) {
    return invalid('PA_INTERNAL_INPUT', 'product.allowedViews');
  }
  if (value.allowedViews.some((item) => !GARMENT_VIEWS.has(item))) {
    return invalid('PA_INTERNAL_INPUT', 'product.allowedViews');
  }
  if (!validateAudienceConstraints(value.audienceConstraints)) {
    return invalid('PA_INTERNAL_INPUT', 'product.audienceConstraints');
  }
  if (!validateStringArray(value.defaultColors)) {
    return invalid('PA_INTERNAL_INPUT', 'product.defaultColors');
  }
  if (value.expandable !== true) return invalid('PA_INTERNAL_INPUT', 'product.expandable');
  if (hasOwn(value, 'metadata')) {
    if (!isRecord(value.metadata)) return invalid('PA_INTERNAL_INPUT', 'product.metadata');
    for (const metadataValue of Object.values(value.metadata)) {
      if (typeof metadataValue !== 'string')
        return invalid('PA_INTERNAL_INPUT', 'product.metadata');
    }
  }
  if (hasOwn(value, 'productHash') && !validId(value.productHash)) {
    return invalid('PA_INTERNAL_INPUT', 'product.productHash');
  }
  return validateProfile(value.printAreaProfile, 'product.printAreaProfile');
}

function validateScene(value: unknown): PrintAreaEngineResult | null {
  if (!isRecord(value)) return invalid('PA_INTERNAL_INPUT', 'scene');
  const unknown = exactShape(value, SCENE_KEYS);
  if (unknown) return invalid('PA_INTERNAL_INPUT', `scene.${unknown}`);
  const missing = ownsAll(value, SCENE_REQUIRED);
  if (missing) return invalid('PA_INTERNAL_INPUT', `scene.${missing}`);

  const idFields = [
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
  ] as const;
  for (const field of idFields) {
    if (!validId(value[field])) return invalid('PA_INTERNAL_INPUT', `scene.${field}`);
  }
  if (!validateStringArray(value.decorIds) || !validateStringArray(value.propIds)) {
    return invalid('PA_INTERNAL_INPUT', 'scene');
  }
  if (!DISPLAY_METHODS.has(value.displayMethod)) {
    return invalid('PA_INTERNAL_INPUT', 'scene.displayMethod');
  }
  if (!GARMENT_VIEWS.has(value.view)) return invalid('PA_INTERNAL_INPUT', 'scene.view');
  if (!positiveInteger(value.sceneVersion))
    return invalid('PA_INTERNAL_INPUT', 'scene.sceneVersion');
  if (!isRecord(value.dedupSignature) || !isRecord(value.outputA)) {
    return invalid('PA_INTERNAL_INPUT', 'scene');
  }
  if (value.outputB !== null && !isRecord(value.outputB)) {
    return invalid('PA_INTERNAL_INPUT', 'scene.outputB');
  }
  return null;
}

function validateObservation(value: unknown): PrintAreaEngineResult | null {
  if (!isRecord(value)) return invalid('PA_INTERNAL_MEASUREMENT', 'observation');
  const unknown = exactShape(value, OBSERVATION_KEYS);
  if (unknown) return invalid('PA_INTERNAL_MEASUREMENT', `observation.${unknown}`);
  const missing = ownsAll(value, [...OBSERVATION_KEYS]);
  if (missing) return invalid('PA_INTERNAL_MEASUREMENT', `observation.${missing}`);

  if (!isDenseBoundedArray(value.overlaps)) {
    return Array.isArray(value.overlaps) && value.overlaps.length > MAX_ARRAY
      ? invalid('PA_INTERNAL_LIMIT', 'observation.overlaps')
      : invalid('PA_INTERNAL_MEASUREMENT', 'observation.overlaps');
  }
  if (value.overlaps.some((item) => !OBSTRUCTIONS.has(item))) {
    return invalid('PA_INTERNAL_MEASUREMENT', 'observation.overlaps');
  }
  if (
    !finiteNonNegative(value.sizeRatio) ||
    !finiteNonNegative(value.centeringOffset) ||
    !finiteNonNegative(value.shadowCoverage)
  ) {
    return invalid('PA_INTERNAL_MEASUREMENT', 'observation');
  }
  return null;
}

function validateConstraint(value: unknown, index: number): PrintAreaEngineResult | null {
  const path = `constraints.${index}`;
  if (!isRecord(value)) return invalid('PA_INTERNAL_INPUT', path);
  const unknown = exactShape(value, CONSTRAINT_KEYS);
  if (unknown) return invalid('PA_INTERNAL_INPUT', `${path}.${unknown}`);
  const missing = ownsAll(value, [...CONSTRAINT_KEYS]);
  if (missing) return invalid('PA_INTERNAL_INPUT', `${path}.${missing}`);
  if (!validId(value.bucketKey) || !validString(value.target))
    return invalid('PA_INTERNAL_INPUT', path);
  if (!RULE_DOMAINS.has(value.domain)) return invalid('PA_INTERNAL_INPUT', `${path}.domain`);
  if (typeof value.forbidden !== 'boolean' || typeof value.required !== 'boolean') {
    return invalid('PA_INTERNAL_INPUT', path);
  }
  if (value.lockedTo !== null && !validateStringArray(value.lockedTo)) {
    return invalid('PA_INTERNAL_INPUT', `${path}.lockedTo`);
  }
  if (value.limit !== null && !finiteNonNegative(value.limit)) {
    return invalid('PA_INTERNAL_INPUT', `${path}.limit`);
  }
  if (!validateStringArray(value.winningRuleIds)) {
    return invalid('PA_INTERNAL_INPUT', `${path}.winningRuleIds`);
  }
  return null;
}

export function validatePrintAreaInput(input: PrintAreaEngineInput): PrintAreaEngineResult | null {
  const inspection = inspectRuntimeShape(input);
  if (inspection === 'limit') return invalid('PA_INTERNAL_LIMIT', 'input');
  if (inspection === 'unsafe') return invalid('PA_INTERNAL_CYCLE', 'input');

  if (!isRecord(input)) return invalid('PA_INTERNAL_INPUT', 'input');
  const missingInput = ownsAll(input, INPUT_REQUIRED);
  if (missingInput) return invalid('PA_INTERNAL_INPUT', `input.${missingInput}`);

  const profileFailure = validateProfile(input.profile, 'profile');
  if (profileFailure) return profileFailure;
  const productFailure = validateProduct(input.product);
  if (productFailure) return productFailure;
  const sceneFailure = validateScene(input.scene);
  if (sceneFailure) return sceneFailure;
  const observationFailure = validateObservation(input.observation);
  if (observationFailure) return observationFailure;

  const sceneValue = input.scene as unknown as RecordValue;
  const productValue = input.product as unknown as RecordValue;
  const profileValue = input.profile as unknown as RecordValue;
  const productProfile = productValue.printAreaProfile as RecordValue;

  if (sceneValue.productId !== productValue.id) {
    return invalid('PA_INTERNAL_PRODUCT', 'scene.productId');
  }
  if (!equivalentProfiles(profileValue, productProfile)) {
    return invalid('PA_INTERNAL_PROFILE', 'product.printAreaProfile');
  }
  if (sceneValue.printAreaRulesRef !== profileValue.id) {
    return invalid('PA_INTERNAL_PROFILE', 'scene.printAreaRulesRef');
  }

  if (hasOwn(input, 'requestedPosition') && input.requestedPosition !== undefined) {
    if (typeof input.requestedPosition !== 'string' || !POSITIONS.has(input.requestedPosition)) {
      return invalid('PA_INTERNAL_POSITION', 'requestedPosition');
    }
    if (input.requestedPosition !== profileValue.position) {
      return invalid('PA_INTERNAL_POSITION', 'requestedPosition');
    }
  }

  if (hasOwn(input, 'constraints') && input.constraints !== undefined) {
    const constraintsValue: unknown = input.constraints;
    if (!isDenseBoundedArray(constraintsValue)) {
      return Array.isArray(constraintsValue) && constraintsValue.length > MAX_ARRAY
        ? invalid('PA_INTERNAL_LIMIT', 'constraints')
        : invalid('PA_INTERNAL_INPUT', 'constraints');
    }
    for (let index = 0; index < constraintsValue.length; index += 1) {
      const constraintFailure = validateConstraint(constraintsValue[index], index);
      if (constraintFailure) return constraintFailure;
    }
  }

  return null;
}
