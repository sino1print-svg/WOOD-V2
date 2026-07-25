import {
  RuleDomain,
  type Color,
  type ColorId,
  type Palette,
  type PaletteId,
  type ResolvedConstraint,
  type RuleId,
  type SchemaVersion,
} from '../../src/shared/domain-model';
import type { PaletteEngineInput } from '../../src/engines/palette-engine';

export const colorId = (value: string) => value as ColorId;
const schemaVersion = 1 as SchemaVersion;

export const COLORS: readonly Color[] = [
  { id: colorId('black'), name: 'Black', hex: '#000000' as Color['hex'] },
  { id: colorId('navy'), name: 'Navy', hex: '#000080' as Color['hex'] },
  { id: colorId('red'), name: 'Red', hex: '#ff0000' as Color['hex'] },
  { id: colorId('sand'), name: 'Sand', hex: '#d8c3a5' as Color['hex'] },
  { id: colorId('white'), name: 'White', hex: '#ffffff' as Color['hex'] },
];

export const PALETTES: readonly Palette[] = [
  {
    id: 'palette-neutral' as PaletteId,
    schemaVersion,
    name: 'Neutral',
    colorIds: [colorId('white'), colorId('black')],
    lockRules: [],
  },
];

export function constraint(overrides: Partial<ResolvedConstraint> = {}): ResolvedConstraint {
  return {
    bucketKey: 'bucket',
    domain: RuleDomain.Palette,
    target: 'white',
    forbidden: false,
    lockedTo: null,
    limit: null,
    required: false,
    winningRuleIds: ['rule-1' as RuleId],
    ...overrides,
  };
}

export function input(overrides: Partial<PaletteEngineInput> = {}): PaletteEngineInput {
  return {
    selection: { colorIds: [colorId('white'), colorId('black')], locked: true },
    library: { colors: COLORS, palettes: PALETTES },
    constraints: [],
    ...overrides,
  };
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
