/**
 * Branded entity identifiers — 03_DATA_MODELS_FINAL §1.2.
 * Nominal, non-interchangeable IDs to prevent cross-entity confusion.
 */

export type ProjectId = string & { readonly __brand: 'ProjectId' };
export type SessionId = string & { readonly __brand: 'SessionId' };
export type ProductId = string & { readonly __brand: 'ProductId' };
export type SeasonId = string & { readonly __brand: 'SeasonId' };
export type SceneId = string & { readonly __brand: 'SceneId' };
export type SceneTemplateId = string & { readonly __brand: 'SceneTemplateId' };
export type OutputAId = string & { readonly __brand: 'OutputAId' };
export type OutputBId = string & { readonly __brand: 'OutputBId' };
export type ArtworkId = string & { readonly __brand: 'ArtworkId' };
export type CoverId = string & { readonly __brand: 'CoverId' };
export type GroupId = string & { readonly __brand: 'GroupId' };
export type PaletteId = string & { readonly __brand: 'PaletteId' };
export type ColorId = string & { readonly __brand: 'ColorId' };
export type RuleId = string & { readonly __brand: 'RuleId' };
export type RuleSetId = string & { readonly __brand: 'RuleSetId' };
export type PromptModuleId = string & { readonly __brand: 'PromptModuleId' };
export type PrintAreaRuleSetId = string & { readonly __brand: 'PrintAreaRuleSetId' };
export type ValidationResultId = string & { readonly __brand: 'ValidationResultId' };
export type VersionId = string & { readonly __brand: 'VersionId' };
export type AssetRef = string & { readonly __brand: 'AssetRef' };
export type EventId = string & { readonly __brand: 'EventId' };

// Vocabulary reference ids (open, data-library-backed).
export type LocationId = string & { readonly __brand: 'LocationId' };
export type LightingId = string & { readonly __brand: 'LightingId' };
export type DecorId = string & { readonly __brand: 'DecorId' };
export type PropId = string & { readonly __brand: 'PropId' };
export type CameraId = string & { readonly __brand: 'CameraId' };
export type CompositionId = string & { readonly __brand: 'CompositionId' };
export type PoseId = string & { readonly __brand: 'PoseId' };
export type VocabularyId = string & { readonly __brand: 'VocabularyId' };
