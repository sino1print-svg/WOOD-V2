/**
 * Color Assignment — §14.2. `scene[i].paletteColorId = sortedSelectedColors[i mod n]`,
 * walking scenes in `sceneOrder`. No randomness; single formula, no special-casing.
 * Hero scenes receiving the flagship color "first" (§14.2) is a direct consequence of
 * this formula plus hero-first `sceneOrder` (§7.4/§10.1) — not a separate rule.
 */
import type { ColorId } from '../../shared/domain-model';

export function assignColors(
  sceneCount: number,
  selectedColorIds: readonly ColorId[],
): readonly ColorId[] {
  if (selectedColorIds.length === 0) return [];
  const sorted = [...selectedColorIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return Array.from({ length: sceneCount }, (_, index) => sorted[index % sorted.length]!);
}
