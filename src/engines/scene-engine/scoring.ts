/**
 * Candidate Scoring — §7.2 formula, §7.4 deterministic tie-break. Every factor is a
 * pure function of authored data + the caller-supplied print-area observation; no
 * randomness anywhere (§7.1, §2).
 */
import type { Product } from '../../shared/domain-model';
import type { SceneItemIndex } from './types';
import {
  diversityContribution,
  diversityPenalty,
  computeDiversitySignature,
  type DiversityLedgerState,
} from './diversity';
import type { PrintAreaObserver } from './types';
import type { MoodAnchor, SceneCandidate, ScoredCandidate, SceneLibraryItem } from './types';

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function itemsOf(
  candidate: SceneCandidate,
  itemIndex: SceneItemIndex,
): readonly SceneLibraryItem[] {
  const ids: readonly string[] = [
    candidate.templateId,
    candidate.locationId,
    candidate.lightingId,
    ...candidate.decorIds,
    ...candidate.propIds,
    candidate.cameraId,
    candidate.compositionId,
    candidate.poseId,
  ];
  return ids
    .map((id) => itemIndex.get(id))
    .filter((item): item is SceneLibraryItem => item !== undefined);
}

function printAreaVisibility(
  candidate: SceneCandidate,
  product: Product,
  observe: PrintAreaObserver,
): number {
  const observation = observe({
    product,
    displayMethod: candidate.displayMethod,
    cameraAngle: candidate.cameraAngle,
    compositionId: candidate.compositionId,
    locationId: candidate.locationId,
    poseId: candidate.poseId,
    propIds: candidate.propIds,
  });
  const sizeScore = clamp01(observation.sizeRatio);
  const centeringScore = clamp01(1 - observation.centeringOffset);
  const cleanlinessScore = clamp01(1 - observation.shadowCoverage);
  const obstructionPenalty = observation.overlaps.length === 0 ? 1 : 0.5;
  return sizeScore * centeringScore * cleanlinessScore * obstructionPenalty;
}

function conversionValue(items: readonly SceneLibraryItem[]): number {
  if (items.length === 0) return 0;
  const sum = items.reduce((acc, item) => acc + clamp01(item.weight), 0);
  return sum / items.length;
}

function commercialRealism(
  items: readonly SceneLibraryItem[],
  moodTags: readonly string[],
): number {
  if (items.length === 0 || moodTags.length === 0) return 0;
  const moodSet = new Set(moodTags);
  const coherent = items.filter((item) => item.tags.some((tag) => moodSet.has(tag))).length;
  return coherent / items.length;
}

function sessionConsistency(
  candidate: SceneCandidate,
  anchor: MoodAnchor,
  lightingId: string,
): number {
  let matches = 0;
  const checks = 2;
  if (anchor.productIds.includes(candidate.productId)) matches += 1;
  if (anchor.dominantLightingId !== null && anchor.dominantLightingId === lightingId) matches += 1;
  return matches / checks;
}

export interface ScoringContext {
  readonly itemIndex: SceneItemIndex;
  readonly products: ReadonlyMap<string, Product>;
  readonly moodAnchor: MoodAnchor;
  readonly observePrintArea: PrintAreaObserver;
  readonly diversityLedger: DiversityLedgerState;
  readonly requestedSceneCount: number;
}

export function scoreCandidate(
  candidate: SceneCandidate,
  context: ScoringContext,
): ScoredCandidate {
  const product = context.products.get(candidate.productId);
  if (!product) throw new Error('scoreCandidate: unknown product referenced by candidate');

  const items = itemsOf(candidate, context.itemIndex);
  const signature = computeDiversitySignature(candidate, context.itemIndex);

  const visibility = printAreaVisibility(candidate, product, context.observePrintArea);
  const conversion = conversionValue(items);
  const realism = commercialRealism(items, context.moodAnchor.seasonMoodTags);
  const consistency = sessionConsistency(candidate, context.moodAnchor, candidate.lightingId);
  const diversity = diversityContribution(
    context.diversityLedger,
    context.requestedSceneCount,
    signature,
  );
  const penalty = diversityPenalty(context.diversityLedger, context.requestedSceneCount, signature);

  const score =
    0.3 * visibility +
    0.25 * conversion +
    0.2 * realism +
    0.15 * consistency +
    0.1 * diversity -
    penalty;
  const maxPriority = items.reduce(
    (max, item) => Math.max(max, item.priority),
    Number.NEGATIVE_INFINITY,
  );

  return Object.freeze({
    candidate,
    score,
    maxPriority: items.length === 0 ? 0 : maxPriority,
    breakdown: Object.freeze({
      printAreaVisibility: visibility,
      conversionValue: conversion,
      commercialRealism: realism,
      sessionConsistency: consistency,
      diversityContribution: diversity,
      penalty,
    }),
  });
}

/** §7.4 deterministic total order: score DESC, max priority DESC, dedupHash ASC. */
export function compareScored(a: ScoredCandidate, b: ScoredCandidate): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.maxPriority !== b.maxPriority) return b.maxPriority - a.maxPriority;
  return a.candidate.dedupHash < b.candidate.dedupHash
    ? -1
    : a.candidate.dedupHash > b.candidate.dedupHash
      ? 1
      : 0;
}
