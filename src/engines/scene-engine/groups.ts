/**
 * Group Planning — §18. Groups partition `sceneOrder` by exactly one `GroupBy`
 * dimension. Groups are created in lexicographic order of `key`; members are listed
 * in `sceneOrder` (18.1). Numbering (§18.2) is derived purely from `groupBy`, key
 * order, and `sceneOrder`, so it is fully reproducible.
 */
import type {
  ColorId,
  GarmentView,
  Group,
  GroupId,
  ProductId,
  Scene,
  SessionId,
} from '../../shared/domain-model';
import { GroupBy } from '../../shared/domain-model';

function compareLex(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function keyFor(scene: Scene, groupBy: GroupBy): string {
  if (groupBy === GroupBy.Product) return scene.productId;
  if (groupBy === GroupBy.Color) return scene.paletteColorId;
  return scene.view;
}

export function planGroups(
  sessionId: SessionId,
  sceneOrder: readonly Scene['id'][],
  scenesById: ReadonlyMap<Scene['id'], Scene>,
  groupBy: GroupBy,
): readonly Group[] {
  const byKey = new Map<string, Scene['id'][]>();
  for (const sceneId of sceneOrder) {
    const scene = scenesById.get(sceneId);
    if (!scene) continue;
    const key = keyFor(scene, groupBy);
    const list = byKey.get(key) ?? [];
    list.push(sceneId);
    byKey.set(key, list);
  }

  const sortedKeys = [...byKey.keys()].sort(compareLex);
  return sortedKeys.map((key) => {
    const groupId = `group-${groupBy}-${key}` as GroupId;
    return Object.freeze({
      id: groupId,
      sessionId,
      groupBy,
      key: key as ProductId | ColorId | GarmentView,
      sceneIds: Object.freeze([...byKey.get(key)!]),
      groupPromptText: null,
    });
  });
}

/** §18.2 numbering scheme — pure display-label derivation, not persisted state. */
export function groupNumber(groups: readonly Group[], groupId: GroupId): number {
  return groups.findIndex((group) => group.id === groupId) + 1;
}

export function sceneNumber(group: Group, sceneId: Scene['id']): number {
  return group.sceneIds.findIndex((id) => id === sceneId) + 1;
}

export function outputLabel(
  groupIndex: number,
  sceneIndexInGroup: number,
  kind: 'A' | 'B',
): string {
  return `${groupIndex}.${sceneIndexInGroup}-${kind}`;
}
