import type { ColorId } from '../../shared/domain-model';

export function canonicalColorIds(values: readonly ColorId[]): readonly ColorId[] {
  return [...new Set(values)].sort(bytewiseCompare);
}

export function intersectColorIds(
  left: readonly ColorId[],
  right: readonly ColorId[],
): readonly ColorId[] {
  const rightSet = new Set(right);
  return canonicalColorIds(left.filter((value) => rightSet.has(value)));
}

export function excludeColorIds(
  source: readonly ColorId[],
  excluded: readonly ColorId[],
): readonly ColorId[] {
  const excludedSet = new Set(excluded);
  return canonicalColorIds(source.filter((value) => !excludedSet.has(value)));
}

export function containsColor(source: readonly ColorId[], value: ColorId): boolean {
  return source.includes(value);
}

export function bytewiseCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
