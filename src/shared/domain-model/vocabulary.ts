/**
 * Open controlled vocabularies — 03_DATA_MODELS_FINAL §2.2.
 */
import type {
  CameraId,
  CompositionId,
  DecorId,
  LightingId,
  LocationId,
  PoseId,
  PropId,
  VocabularyId,
} from './ids';
import type { ById } from './primitives';
import { CameraAngle, VocabularyKind } from './enums';

export interface VocabularyTerm {
  readonly id: VocabularyId;
  readonly kind: VocabularyKind;
  readonly label: string;
  readonly tags: readonly string[];
  readonly printAreaSafe: boolean;
}

export interface CameraTerm extends VocabularyTerm {
  readonly kind: VocabularyKind.Camera;
  readonly angle: CameraAngle;
  readonly distance?: 'close' | 'medium' | 'wide';
}

export interface ControlledVocabularies {
  readonly locations: ById<LocationId, VocabularyTerm>;
  readonly lightings: ById<LightingId, VocabularyTerm>;
  readonly decors: ById<DecorId, VocabularyTerm>;
  readonly props: ById<PropId, VocabularyTerm>;
  readonly compositions: ById<CompositionId, VocabularyTerm>;
  readonly poses: ById<PoseId, VocabularyTerm>;
  readonly cameras: ById<CameraId, CameraTerm>;
}
