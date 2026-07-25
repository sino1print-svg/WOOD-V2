/**
 * Diversity — §8.2 DiversitySignature axes, §8.3 soft caps/penalty, §9 mood anchor +
 * coverage rotation. All state here is a Scene Engine planning construct — never
 * persisted (§8.2), rebuilt fresh per session run, updated deterministically as
 * scenes are greedily selected in score order (engine.ts).
 */
import type { ColorSelection, ProductId } from '../../shared/domain-model';
import type { SceneItemIndex } from './types';
import { computeSoftCap } from './sizing';
import type {
  DiversitySignature,
  MoodAnchor,
  SceneCandidate,
  SceneLibrary,
  SceneLibraryItem,
} from './types';

const DIVERSITY_AXES = [
  'poseFamily',
  'camera',
  'composition',
  'background',
  'decor',
  'product',
  'sceneMood',
  'overallFeel',
] as const;
export type DiversityAxis = (typeof DIVERSITY_AXES)[number];

function poseFamilyOf(pose: SceneLibraryItem | undefined): string {
  const familyTag = pose?.tags.find((tag) => tag.startsWith('model:'));
  return familyTag ?? pose?.id ?? 'unknown';
}

function dominantTag(items: readonly (SceneLibraryItem | undefined)[]): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!item) continue;
    for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = -1;
  for (const [tag, count] of [...counts.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    if (count > bestCount) {
      best = tag;
      bestCount = count;
    }
  }
  return best ?? 'neutral';
}

export function buildMoodAnchor(
  colorSelection: ColorSelection,
  productIds: readonly ProductId[],
  library: SceneLibrary,
  seasonMoodTags: readonly string[],
): MoodAnchor {
  const dominantLighting =
    [...library.lightings].sort((a, b) => b.weight - a.weight || (a.id < b.id ? -1 : 1))[0] ?? null;
  return Object.freeze({
    seasonMoodTags: [...seasonMoodTags].sort(),
    paletteColorIds: [...colorSelection.colorIds].sort(),
    productIds: [...productIds].sort() as readonly ProductId[],
    dominantLightingId: dominantLighting ? dominantLighting.id : null,
  });
}

export function computeDiversitySignature(
  candidate: SceneCandidate,
  itemIndex: SceneItemIndex,
): DiversitySignature {
  const pose = itemIndex.get(candidate.poseId);
  const composition = itemIndex.get(candidate.compositionId);
  const location = itemIndex.get(candidate.locationId);
  const decor = candidate.decorIds[0] ? itemIndex.get(candidate.decorIds[0]) : undefined;
  const lighting = itemIndex.get(candidate.lightingId);

  return Object.freeze({
    poseFamily: poseFamilyOf(pose),
    camera: candidate.cameraAngle,
    composition: candidate.compositionId,
    background:
      location?.tags.find((tag) => tag.startsWith('background:')) ?? location?.id ?? 'unknown',
    decor: decor?.id ?? 'none',
    product: candidate.productId,
    sceneMood: dominantTag([pose, composition, decor, location]),
    overallFeel: [
      lighting?.tags[0] ?? 'neutral',
      composition?.id ?? 'none',
      candidate.displayMethod,
    ].join('|'),
  });
}

export interface DiversityLedgerState {
  readonly usage: Map<DiversityAxis, Map<string, number>>;
  readonly distinctValuesByAxis: Map<DiversityAxis, number>;
}

export function createDiversityLedger(
  candidates: readonly SceneCandidate[],
  itemIndex: SceneItemIndex,
): DiversityLedgerState {
  const usage = new Map<DiversityAxis, Map<string, number>>();
  const distinctSets = new Map<DiversityAxis, Set<string>>();
  for (const axis of DIVERSITY_AXES) {
    usage.set(axis, new Map());
    distinctSets.set(axis, new Set());
  }
  for (const candidate of candidates) {
    const signature = computeDiversitySignature(candidate, itemIndex);
    for (const axis of DIVERSITY_AXES) {
      distinctSets.get(axis)!.add(signature[axis]);
    }
  }
  const distinctValuesByAxis = new Map<DiversityAxis, number>();
  for (const axis of DIVERSITY_AXES) {
    distinctValuesByAxis.set(axis, Math.max(1, distinctSets.get(axis)!.size));
  }
  return { usage, distinctValuesByAxis };
}

export function recordDiversityUsage(
  ledger: DiversityLedgerState,
  signature: DiversitySignature,
): void {
  for (const axis of DIVERSITY_AXES) {
    const map = ledger.usage.get(axis)!;
    const value = signature[axis];
    map.set(value, (map.get(value) ?? 0) + 1);
  }
}

export function diversityContribution(
  ledger: DiversityLedgerState,
  requestedSceneCount: number,
  signature: DiversitySignature,
): number {
  let total = 0;
  for (const axis of DIVERSITY_AXES) {
    const distinct = ledger.distinctValuesByAxis.get(axis)!;
    const softCap = computeSoftCap(requestedSceneCount, distinct);
    const used = ledger.usage.get(axis)!.get(signature[axis]) ?? 0;
    total += Math.max(0, 1 - used / Math.max(1, softCap));
  }
  return total / DIVERSITY_AXES.length;
}

const PENALTY_PER_AXIS_OVER_CAP = 0.05;

export function diversityPenalty(
  ledger: DiversityLedgerState,
  requestedSceneCount: number,
  signature: DiversitySignature,
): number {
  let penalty = 0;
  for (const axis of DIVERSITY_AXES) {
    const distinct = ledger.distinctValuesByAxis.get(axis)!;
    const softCap = computeSoftCap(requestedSceneCount, distinct);
    const used = ledger.usage.get(axis)!.get(signature[axis]) ?? 0;
    if (used >= softCap) penalty += PENALTY_PER_AXIS_OVER_CAP * (used - softCap + 1);
  }
  return penalty;
}
