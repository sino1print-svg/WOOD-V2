/**
 * View Assignment — §15.2. Hero scenes default to Front (V-1); support scenes fill
 * back/side/detail in a fixed deterministic pool order (V-2/V-3/V-4), never assigning
 * outside `product.allowedViews` (V-6). Computed after ordering by walking
 * `sceneOrder` (V-5) — no randomness.
 */
import { GarmentView } from '../../shared/domain-model';
import { sceneFailureFromCode } from './failures';
import type { ValidationFailure } from '../../shared/domain-model';

/** Fixed deterministic support-pool priority: back before side before detail (V-2/V-3/V-4). */
const SUPPORT_VIEW_PRIORITY: readonly GarmentView[] = [
  GarmentView.Back,
  GarmentView.Side,
  GarmentView.FlatDetail,
];

export interface ViewAssignmentSlot {
  readonly isHero: boolean;
  readonly allowedViews: readonly GarmentView[];
}

export type ViewAssignmentResult =
  | { readonly ok: true; readonly views: readonly GarmentView[] }
  | { readonly ok: false; readonly failures: readonly ValidationFailure[] };

export function assignViews(slots: readonly ViewAssignmentSlot[]): ViewAssignmentResult {
  const views: GarmentView[] = [];
  const failures: ValidationFailure[] = [];

  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index]!;
    if (slot.allowedViews.length === 0) {
      failures.push(
        sceneFailureFromCode('RULE_PRD_003', `scene[${index}].view`, {
          detail: 'no allowed views for product',
        }),
      );
      continue;
    }

    if (slot.isHero) {
      const view = slot.allowedViews.includes(GarmentView.Front)
        ? GarmentView.Front
        : slot.allowedViews[0]!;
      views.push(view);
      continue;
    }

    const supportPool = SUPPORT_VIEW_PRIORITY.filter((view) => slot.allowedViews.includes(view));
    const pool = supportPool.length > 0 ? supportPool : slot.allowedViews;
    views.push(pool[index % pool.length]!);
  }

  if (failures.length > 0) return { ok: false, failures };
  return { ok: true, views };
}
