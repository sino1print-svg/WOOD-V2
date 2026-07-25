import type {
  Color,
  ColorId,
  ColorSelection,
  Palette,
  ResolvedConstraint,
  RuleId,
  ValidationFailure,
} from '../../shared/domain-model';

export interface PaletteEngineSafetyLimits {
  readonly maxColors: number;
  readonly maxPalettes: number;
  readonly maxConstraints: number;
  readonly maxIdLength: number;
}

export interface PaletteLibrary {
  readonly colors: readonly Color[];
  readonly palettes: readonly Palette[];
}

export interface PaletteEngineInput {
  readonly selection: ColorSelection;
  readonly library: PaletteLibrary;
  readonly constraints: readonly ResolvedConstraint[];
  readonly requestedGarmentColorId?: ColorId;
}

export interface PaletteDiagnostic {
  readonly code: string;
  readonly messageAr: string;
  readonly messageEn: string;
  readonly ruleIds: readonly RuleId[];
  readonly domain: 'palette' | 'garment_color' | 'input';
}

export interface ResolvedPalette {
  readonly colorIds: readonly ColorId[];
  readonly locked: boolean;
  readonly paletteId: ColorSelection['paletteId'] | null;
  readonly diagnostics: readonly PaletteDiagnostic[];
}

export interface GarmentColorValidation {
  readonly allowed: boolean | null;
  readonly diagnostics: readonly PaletteDiagnostic[];
}

export type GarmentColorStageResult =
  | { readonly ok: true; readonly value: GarmentColorValidation }
  | { readonly ok: false; readonly failures: readonly ValidationFailure[] };

export type PaletteStageResult =
  | { readonly ok: true; readonly value: ResolvedPalette }
  | { readonly ok: false; readonly failures: readonly ValidationFailure[] };

export interface PaletteResolution extends ResolvedPalette {
  readonly colorIds: readonly ColorId[];
  readonly locked: boolean;
  readonly paletteId: ColorSelection['paletteId'] | null;
  readonly garmentColorAllowed: boolean | null;
  readonly diagnostics: readonly PaletteDiagnostic[];
}

export type PaletteEngineResult =
  | { readonly ok: true; readonly value: PaletteResolution }
  | { readonly ok: false; readonly failures: readonly ValidationFailure[] };
