import { CoverLayout } from '../../shared/domain-model';
import type { CoverLayoutPlan } from './types';

export function deriveCoverLayout(count: number): CoverLayoutPlan {
  if (count === 1) {
    return { layout: CoverLayout.Single, columns: 1, rows: 1, capacity: 1, heroSpan: 'full-bleed' };
  }
  if (count === 2) {
    return { layout: CoverLayout.Duo, columns: 2, rows: 1, capacity: 2, heroSpan: '1x1' };
  }
  if (count === 3) {
    return { layout: CoverLayout.Triptych, columns: 3, rows: 1, capacity: 3, heroSpan: '1x1' };
  }
  if (count === 4) {
    return { layout: CoverLayout.Grid2x2, columns: 2, rows: 2, capacity: 4, heroSpan: '1x1' };
  }
  if (count <= 6) {
    return { layout: CoverLayout.Grid2x3, columns: 2, rows: 3, capacity: 6, heroSpan: '1x1' };
  }
  if (count <= 9) {
    return {
      layout: CoverLayout.Grid3x3,
      columns: 3,
      rows: 3,
      capacity: 9,
      heroSpan: count >= 8 ? '2x2' : '1x1',
    };
  }
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  return {
    layout: CoverLayout.Mosaic,
    columns,
    rows,
    capacity: columns * rows,
    heroSpan: '2x2',
  };
}
