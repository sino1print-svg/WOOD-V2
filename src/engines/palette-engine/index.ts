export { resolvePalette, resolvePaletteStage, validateGarmentColorStage } from './engine';
export {
  canonicalColorIds,
  containsColor,
  excludeColorIds,
  intersectColorIds,
} from './set-operations';
export type {
  GarmentColorStageResult,
  GarmentColorValidation,
  PaletteDiagnostic,
  PaletteEngineInput,
  PaletteEngineResult,
  PaletteEngineSafetyLimits,
  PaletteLibrary,
  PaletteResolution,
  PaletteStageResult,
  ResolvedPalette,
} from './types';
