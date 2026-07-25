/**
 * Session sizing — §10.1 hero/support composition table. The table gives exact,
 * authored ratios for the six documented canonical sizes; for any other
 * `requestedSceneCount` the spec's own documented approximation
 * (`hero = round(count × 0.3)`) is used as the deterministic fallback, since no
 * other formula is given. Both paths are fixed functions of `count` alone — no
 * randomness, no state.
 */

export interface SessionSizeProfile {
  readonly requestedSceneCount: number;
  readonly heroCount: number;
  readonly supportCount: number;
}

const DOCUMENTED_SIZES: Readonly<Record<number, number>> = Object.freeze({
  4: 2,
  8: 3,
  12: 4,
  20: 6,
  40: 10,
  50: 12,
});

export function computeSessionSizeProfile(requestedSceneCount: number): SessionSizeProfile {
  const documented = DOCUMENTED_SIZES[requestedSceneCount];
  const heroCount =
    documented !== undefined
      ? documented
      : Math.min(requestedSceneCount, Math.max(0, Math.round(requestedSceneCount * 0.3)));
  return Object.freeze({
    requestedSceneCount,
    heroCount,
    supportCount: requestedSceneCount - heroCount,
  });
}

/**
 * §8.3 — soft diversity cap for one axis: `ceil(count / distinctValuesForAxis)`.
 * `distinctValuesForAxis` must be >= 1 (guaranteed upstream by feasibility, §6.4).
 */
export function computeSoftCap(requestedSceneCount: number, distinctValuesForAxis: number): number {
  const distinct = Math.max(1, distinctValuesForAxis);
  return Math.ceil(requestedSceneCount / distinct);
}
