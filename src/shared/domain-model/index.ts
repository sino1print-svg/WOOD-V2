/**
 * shared/domain-model — public surface.
 * Single source of truth for domain types (12_IMPLEMENTATION_GUIDE §4).
 * Types are transcribed from 03_DATA_MODELS_FINAL. No engine logic lives here.
 */
export * from './primitives';
export * from './ids';
export * from './enums';
export * from './vocabulary';
export * from './rules';
export * from './entities';
export * from './evaluation';
export * from './events';
export * from './export-manifest';
