/**
 * Cover Metadata Preparation — §19.1. The Scene Engine prepares `CoverMetadata` from
 * Sale Images (Output A) only, and never builds the cover itself (§19.1, §5).
 */
import type {
  Audience,
  ColorId,
  CoverMetadata,
  GarmentView,
  ProductId,
  Scene,
  SeasonId,
} from '../../shared/domain-model';

function compareLex(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Deterministic mode: most frequent value; tie broken by the given comparator (smallest wins). */
function mode<T extends string>(values: readonly T[], compare: (a: T, b: T) => number): T {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const entries = [...counts.entries()].sort(([a], [b]) => compare(a, b));
  let best = entries[0]![0];
  let bestCount = entries[0]![1];
  for (const [value, count] of entries) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

const GARMENT_VIEW_ORDER: readonly GarmentView[] = [
  'front',
  'back',
  'side',
  'flat_detail',
] as GarmentView[];

export function prepareCoverMetadata(
  scenes: readonly Scene[],
  seasonId: SeasonId,
  digitalProductStatus: boolean,
  primaryAudience: Audience,
): CoverMetadata {
  const productIds = [...new Set(scenes.map((s) => s.productId))].sort(
    compareLex,
  ) as readonly ProductId[];
  const colors = [...new Set(scenes.map((s) => s.paletteColorId))].sort(
    compareLex,
  ) as readonly ColorId[];
  const views = [...new Set(scenes.map((s) => s.view))].sort(
    (a, b) => GARMENT_VIEW_ORDER.indexOf(a) - GARMENT_VIEW_ORDER.indexOf(b),
  );

  const primaryProduct = mode(
    scenes.map((s) => s.productId),
    compareLex,
  );
  const primaryColor = mode(
    scenes.map((s) => s.paletteColorId),
    compareLex,
  );
  const primaryView = mode(
    scenes.map((s) => s.view),
    (a, b) => GARMENT_VIEW_ORDER.indexOf(a) - GARMENT_VIEW_ORDER.indexOf(b),
  );

  return Object.freeze({
    productIds,
    colors,
    mockupCount: scenes.length,
    views,
    seasonId,
    digitalProductStatus,
    primaryProduct,
    primaryColor,
    primaryView,
    primaryAudience,
  });
}
