/**
 * Event model — 03_DATA_MODELS_FINAL §3.19. Data contracts only (no dispatcher).
 */
import type { IsoTimestamp, Sha256 } from './primitives';
import type {
  ArtworkId,
  CoverId,
  EventId,
  OutputAId,
  OutputBId,
  ProjectId,
  SceneId,
  SessionId,
  ValidationResultId,
  VersionId,
} from './ids';
import type { CoverLayout, DomainEventType, EngineId } from './enums';

export interface DomainEvent {
  readonly eventId: EventId;
  readonly type: DomainEventType;
  readonly occurredAt: IsoTimestamp;
  readonly projectId: ProjectId;
  readonly sessionId?: SessionId;
  readonly emittedBy: EngineId;
}

export interface SceneCreatedEvent extends DomainEvent {
  readonly type: DomainEventType.SceneCreated;
  readonly sceneId: SceneId;
  readonly sceneFingerprint: Sha256;
}

export interface SceneUpdatedEvent extends DomainEvent {
  readonly type: DomainEventType.SceneUpdated;
  readonly sceneId: SceneId;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly fingerprintChanged: boolean;
}

export interface OutputGeneratedEvent extends DomainEvent {
  readonly type: DomainEventType.OutputGenerated;
  readonly sceneId: SceneId;
  readonly outputKind: 'A' | 'B';
  readonly outputId: OutputAId | OutputBId;
  readonly contentHash: Sha256;
}

export interface ArtworkUploadedEvent extends DomainEvent {
  readonly type: DomainEventType.ArtworkUploaded;
  readonly artworkId: ArtworkId;
  readonly contentHash: Sha256;
}

export interface CoverGeneratedEvent extends DomainEvent {
  readonly type: DomainEventType.CoverGenerated;
  readonly coverId: CoverId;
  readonly layout: CoverLayout;
  readonly coverHash: Sha256;
}

export interface ValidationCompletedEvent extends DomainEvent {
  readonly type: DomainEventType.ValidationCompleted;
  readonly validationResultId: ValidationResultId;
  readonly passed: boolean;
  readonly blockingCount: number;
}

export interface ProjectSavedEvent extends DomainEvent {
  readonly type: DomainEventType.ProjectSaved;
  readonly versionId: VersionId;
  readonly stateHash: Sha256;
}

export type AnyDomainEvent =
  | SceneCreatedEvent
  | SceneUpdatedEvent
  | OutputGeneratedEvent
  | ArtworkUploadedEvent
  | CoverGeneratedEvent
  | ValidationCompletedEvent
  | ProjectSavedEvent;
