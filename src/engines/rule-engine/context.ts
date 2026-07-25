import type { EvaluationContext, ValidationFailure } from '../../shared/domain-model';
import { failureFromCode } from './failures';
import type { ResolutionResult, RuleEngineSafetyLimits } from './types';

const DANGEROUS = new Set(['__proto__', 'prototype', 'constructor']);

export const AUTHORIZED_CONTEXT_PATHS = Object.freeze([
  'session.audience',
  'session.season',
  'session.productIds',
  'session.colorSelection.colorIds',
  'session.colorSelection.locked',
  'session.requestedSceneCount',
  'scene.productId',
  'scene.decorIds',
  'scene.propIds',
  'scene.poseId',
  'scene.cameraAngle',
  'scene.compositionId',
  'scene.displayMethod',
  'scene.paletteColorId',
  'scene.view',
  'scene.modelType',
  'scene.isDuplicate',
  'scene.garmentColorAllowed',
  'printArea.overlaps',
  'printArea.sizeRatio',
  'printArea.centeringOffset',
  'printArea.shadowCoverage',
  'background.hasReadableText',
  'output.isCollage',
  'output.saleImageHasMarks',
  'outputB.sourceOutputAId',
  'outputB.artworkId',
  'outputB.isStale',
  'artwork.format',
  'artwork.hasTransparency',
  'generationProgress.outputAGenerated',
  'generationProgress.totalScenes',
  'generationProgress.allOutputAReady',
  'cover.sourceRefKinds',
  'cover.hasPreviewRefs',
  'cover.layout',
  'cover.mockupCount',
  'cover.layoutMatchesCount',
] as const);

const AUTHORIZED = new Set<string>(AUTHORIZED_CONTEXT_PATHS);

export interface ContextResolution {
  readonly present: boolean;
  readonly value: unknown;
}

export function resolveContextPath(
  context: EvaluationContext,
  path: string,
  limits: RuleEngineSafetyLimits,
): ResolutionResult<ContextResolution> {
  if (path.length === 0 || path.length > limits.maxContextPathLength || !AUTHORIZED.has(path)) {
    return { ok: false, failure: failureFromCode('RULE_CFG_002', path, null) };
  }
  const segments = path.split('.');
  if (segments.some((segment) => DANGEROUS.has(segment) || segment.length === 0)) {
    return { ok: false, failure: failureFromCode('RULE_CFG_002', path, null) };
  }
  let current: unknown = context;
  for (const segment of segments) {
    if (
      typeof current !== 'object' ||
      current === null ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return { ok: true, value: { present: false, value: undefined } };
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return { ok: true, value: { present: true, value: current } };
}

export function detectCyclicInput(value: unknown): ValidationFailure | null {
  const active = new Set<object>();
  const complete = new Set<object>();
  const stack: Array<{ value: unknown; exit: boolean }> = [{ value, exit: false }];
  while (stack.length > 0) {
    const item = stack.pop()!;
    if (typeof item.value !== 'object' || item.value === null) continue;
    const object = item.value as object;
    if (item.exit) {
      active.delete(object);
      complete.add(object);
      continue;
    }
    if (active.has(object)) return failureFromCode('RE_INTERNAL_CYCLE', 'input', null);
    if (complete.has(object)) continue;
    active.add(object);
    stack.push({ value: object, exit: true });
    for (const child of Object.values(object as Record<string, unknown>)) {
      stack.push({ value: child, exit: false });
    }
  }
  return null;
}
