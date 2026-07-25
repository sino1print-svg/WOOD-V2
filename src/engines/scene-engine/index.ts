/**
 * Deterministic Scene Engine — Phase 9 (Volume 08).
 * Pure leaf module: no persistence, UI, network, filesystem, time, or randomness.
 * Source: docs/spec/05_SCENE_ENGINE.md §§1-19.
 */
export { planScenes } from './engine';
export { buildConstraintIndex } from './constraints';
export type { ConstraintIndex } from './constraints';
export { generateCandidates, uniqueDedupSpaceSize, buildItemIndex } from './candidates';
export { scoreCandidate, compareScored } from './scoring';
export {
  buildMoodAnchor,
  computeDiversitySignature,
  createDiversityLedger,
  recordDiversityUsage,
  diversityContribution,
  diversityPenalty,
} from './diversity';
export { computeSessionSizeProfile, computeSoftCap } from './sizing';
export { assignColors } from './colors';
export { assignViews } from './views';
export { planOutputA, planOutputB } from './outputs';
export { planGroups, groupNumber, sceneNumber, outputLabel } from './groups';
export { prepareCoverMetadata } from './cover-metadata';
export { extendDedupLedger } from './dedup';
export { validateSceneEngineInput } from './validation';
export { stableHash } from './hashing';
export { sceneFailureFromCode } from './failures';
export type {
  SceneLibraryItem,
  SceneTemplateLibraryItem,
  SceneCameraLibraryItem,
  SceneLibrary,
  SceneEngineInput,
  SceneEngineSessionSelections,
  SceneEnginePlan,
  SceneEngineResult,
  SceneEngineEvent,
  SceneCandidate,
  ScoredCandidate,
  MoodAnchor,
  DiversitySignature,
  DiversityLedger,
  PrintAreaObserver,
} from './types';
