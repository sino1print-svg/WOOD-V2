/**
 * Rich Export Coordinator contracts — EX §1–§5, §13, §15, §21–§23.
 *
 * These declarations are additive to the legacy `ExportEngineContract`. They
 * describe the read-only coordinator boundary and contain no export behavior.
 */
import type {
  AnyDomainEvent,
  Color,
  CoverId,
  DomainEvent,
  DomainEventType,
  EngineId,
  ExportFormat,
  ExportManifest,
  ExportScope,
  GroupId,
  IsoTimestamp,
  OutputAId,
  OutputBId,
  Product,
  Project,
  PromptModuleType,
  RuleSetId,
  SchemaVersion,
  SceneId,
  Season,
  SemVer,
  SessionId,
  Sha256,
  ValidationFailure,
  VersionId,
} from '../domain-model';
import type { ExportDeliveryFormat } from './export-refinements';

/** Recursively read-only source data; the Export Coordinator never owns mutation. */
export type ExportReadOnly<T> = T extends readonly unknown[]
  ? { readonly [Key in keyof T]: ExportReadOnly<T[Key]> }
  : T extends string | number | boolean | bigint | symbol | null | undefined
    ? T
    : T extends object
      ? { readonly [Key in keyof T]: ExportReadOnly<T[Key]> }
      : T;

export type NonEmptyExportFormats = readonly [ExportDeliveryFormat, ...ExportDeliveryFormat[]];

export type ExportBackupType = 'full_project' | 'session' | 'version_snapshot';

export type ExportRestoreMode = 'merge' | 'replace';

/**
 * Typed operational selectors over the persisted `ExportScope` taxonomy (EX §3).
 * `scopeDetail` maps directly to the persisted manifest field without widening
 * the domain enum.
 */
export type ExportOperationalScope =
  | {
      readonly baseScope: ExportScope.Output;
      readonly scopeDetail: 'output_a';
      readonly sessionId: SessionId;
      readonly sceneId: SceneId;
      readonly outputAId: OutputAId;
    }
  | {
      readonly baseScope: ExportScope.Output;
      readonly scopeDetail: 'output_b';
      readonly sessionId: SessionId;
      readonly sceneId: SceneId;
      readonly outputBId: OutputBId;
    }
  | {
      readonly baseScope: ExportScope.Output;
      readonly scopeDetail: 'pair';
      readonly sessionId: SessionId;
      readonly sceneId: SceneId;
    }
  | {
      readonly baseScope: ExportScope.Group;
      readonly scopeDetail: 'group' | 'group_a' | 'group_b';
      readonly sessionId: SessionId;
      readonly groupId: GroupId;
    }
  | {
      readonly baseScope: ExportScope.Cover;
      readonly scopeDetail: 'cover';
      readonly sessionId: SessionId;
      readonly coverId: CoverId;
    }
  | {
      readonly baseScope: ExportScope.Session;
      readonly scopeDetail: 'session' | 'execution_plan';
      readonly sessionId: SessionId;
    }
  | {
      readonly baseScope: ExportScope.All;
      readonly scopeDetail: 'complete_project' | 'all';
    }
  | {
      readonly baseScope: ExportScope.All;
      readonly scopeDetail: 'backup';
      readonly backupType: 'full_project';
    }
  | {
      readonly baseScope: ExportScope.All;
      readonly scopeDetail: 'backup';
      readonly backupType: 'session';
      readonly sessionId: SessionId;
    }
  | {
      readonly baseScope: ExportScope.All;
      readonly scopeDetail: 'version_snapshot';
      readonly versionId: VersionId;
    }
  | {
      readonly baseScope: ExportScope.All;
      readonly scopeDetail: 'prompt_pack';
    }
  | {
      readonly baseScope: ExportScope.Session;
      readonly scopeDetail: 'prompt_pack';
      readonly sessionId: SessionId;
    };

/** Authoritative entities and library manifests available to read during export. */
export interface ExportSourceSnapshot {
  readonly project: ExportReadOnly<Project>;
  readonly products: readonly ExportReadOnly<Product>[];
  readonly seasons: readonly ExportReadOnly<Season>[];
  readonly colors: readonly ExportReadOnly<Color>[];
}

export interface ExportEngineVersions {
  readonly applicationVersion: SemVer;
  readonly generatorVersion: SemVer;
  readonly ruleSetVersions: Readonly<Record<RuleSetId, SchemaVersion>>;
  readonly promptModuleVersions: Readonly<Record<PromptModuleType, SemVer>>;
}

/** Resource bounds injected from versioned config (EX §11/§21; IMPL §20/§24). */
export interface ExportSafetyLimits {
  readonly maxPathSegment: number;
  readonly maxPathLength: number;
  readonly maxArtifactBytes: number;
  readonly maxJsonBytes: number;
  readonly maxJsonDepth: number;
  readonly maxZipEntries: number;
  readonly maxArchiveBytes: number;
  readonly maxUncompressedBytes: number;
  readonly maxCompressionRatio: number;
  readonly maxClipboardBytes: number;
}

export type ExportArtifactKind =
  | 'prompt_a'
  | 'prompt_b'
  | 'prompt_pair'
  | 'group_plan'
  | 'execution_plan'
  | 'cover_prompt'
  | 'cover_metadata'
  | 'session_summary'
  | 'project'
  | 'version_snapshot'
  | 'artwork_metadata'
  | 'prompt_metadata'
  | 'validation'
  | 'manifest'
  | 'checksums'
  | 'readme'
  | 'backup'
  | 'archive';

export type ExportArtifactMediaType =
  | 'text/plain;charset=utf-8'
  | 'text/markdown;charset=utf-8'
  | 'application/json'
  | 'application/zip';

/** Clipboard is transient and therefore is not a file-artifact format. */
export type ExportFileFormat = ExportFormat | 'markdown';

export interface ExportArtifact {
  readonly path: string;
  readonly kind: ExportArtifactKind;
  readonly format: ExportFileFormat;
  readonly mediaType: ExportArtifactMediaType;
  readonly bytes: Uint8Array;
  readonly byteLength: number;
  readonly checksum: Sha256;
}

export interface ExportClipboardPayload {
  readonly scope: ExportOperationalScope;
  readonly text: string;
  readonly byteLength: number;
  readonly itemCount: number;
  readonly payloadChecksum: Sha256;
}

export type ExportDeliveryFailureCode =
  | 'EXPORT_CLIP_001'
  | 'EXPORT_CLIP_002'
  | 'EXPORT_FILE_001'
  | 'EXPORT_STORAGE_001';

export interface ExportDeliveryFailure {
  readonly code: ExportDeliveryFailureCode;
  readonly retryable: boolean;
}

export type ExportDeliveryReceipt =
  | {
      readonly channel: 'clipboard';
      readonly format: 'clipboard';
      readonly byteLength: number;
      readonly payloadChecksum: Sha256;
    }
  | {
      readonly channel: 'download';
      readonly format: ExportFileFormat;
      readonly path: string;
      readonly byteLength: number;
      readonly checksum: Sha256;
    };

export type ExportDeliveryResult =
  | { readonly ok: true; readonly receipt: ExportDeliveryReceipt }
  | { readonly ok: false; readonly failure: ExportDeliveryFailure };

export interface ExportClipboardPort {
  write(payload: ExportClipboardPayload): Promise<ExportDeliveryResult>;
}

export interface ExportDownloadPort {
  deliver(artifact: ExportArtifact): Promise<ExportDeliveryResult>;
}

export interface ExportDeliveryPorts {
  readonly clipboard?: ExportClipboardPort;
  readonly download?: ExportDownloadPort;
}

export interface ExportCancellationPort {
  isCancellationRequested(): boolean;
}

export type ExportStage =
  | 'intent'
  | 'scope_resolution'
  | 'validation'
  | 'artifact_selection'
  | 'ordering'
  | 'formatting'
  | 'checksum_generation'
  | 'packaging'
  | 'delivery'
  | 'audit';

export interface ExportProgress {
  readonly exportId: string;
  readonly stage: ExportStage;
  readonly completedArtifacts: number;
  readonly totalArtifacts: number;
  readonly percent: number;
  readonly currentArtifactKind?: ExportArtifactKind;
}

export interface ExportProgressPort {
  report(progress: ExportProgress): void;
}

export interface ExportEngineInput {
  readonly source: ExportSourceSnapshot;
  readonly scope: ExportOperationalScope;
  readonly formats: NonEmptyExportFormats;
  readonly createdAt: IsoTimestamp;
  readonly versions: ExportEngineVersions;
  readonly limits: ExportSafetyLimits;
  readonly delivery?: ExportDeliveryPorts;
  readonly cancellation?: ExportCancellationPort;
  readonly progress?: ExportProgressPort;
}

export interface ExportOmission {
  readonly entityId: string;
  readonly scopeDetail: ExportOperationalScope['scopeDetail'];
  readonly code: string;
}

interface ExportOwnedEvent extends DomainEvent {
  readonly emittedBy: EngineId.Export;
}

interface PersistenceOwnedEvent extends DomainEvent {
  readonly emittedBy: EngineId.Persistence;
}

export interface ExportStartedEvent extends ExportOwnedEvent {
  readonly type: DomainEventType.ExportStarted;
  readonly exportId: string;
  readonly scope: ExportOperationalScope;
  readonly formats: NonEmptyExportFormats;
  readonly sessionIds: readonly SessionId[];
}

export interface ExportCompletedEvent extends ExportOwnedEvent {
  readonly type: DomainEventType.ExportCompleted;
  readonly exportId: string;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly manifestChecksum: Sha256;
}

export interface ExportFailedEvent extends ExportOwnedEvent {
  readonly type: DomainEventType.ExportFailed;
  readonly exportId: string;
  readonly code: string;
  readonly stage: ExportStage;
}

export interface BackupCreatedEvent extends ExportOwnedEvent {
  readonly type: DomainEventType.BackupCreated;
  readonly exportId: string;
  readonly backupType: ExportBackupType;
  readonly stateHash: Sha256;
}

export interface RestoreStartedEvent extends ExportOwnedEvent {
  readonly type: DomainEventType.RestoreStarted;
  readonly backupId: string;
  readonly mode: ExportRestoreMode;
}

export interface RestoreCompletedEvent extends PersistenceOwnedEvent {
  readonly type: DomainEventType.RestoreCompleted;
  readonly backupId: string;
  readonly appliedChanges: number;
}

export interface RestoreFailedEvent extends PersistenceOwnedEvent {
  readonly type: DomainEventType.RestoreFailed;
  readonly backupId: string;
  readonly code: string;
  readonly rolledBack: true;
}

export interface ClipboardCopyCompletedEvent extends ExportOwnedEvent {
  readonly type: DomainEventType.ClipboardCopyCompleted;
  readonly scope: ExportOperationalScope;
  readonly payloadChecksum: Sha256;
}

export interface ClipboardCopyFailedEvent extends ExportOwnedEvent {
  readonly type: DomainEventType.ClipboardCopyFailed;
  readonly scope: ExportOperationalScope;
  readonly code: 'EXPORT_CLIP_001' | 'EXPORT_CLIP_002';
}

export type ExportAuditEvent =
  | ExportStartedEvent
  | ExportCompletedEvent
  | ExportFailedEvent
  | BackupCreatedEvent
  | RestoreStartedEvent
  | RestoreCompletedEvent
  | RestoreFailedEvent
  | ClipboardCopyCompletedEvent
  | ClipboardCopyFailedEvent;

/** Application-wide event union without introducing a domain→contracts dependency. */
export type AnyApplicationDomainEvent = AnyDomainEvent | ExportAuditEvent;

export interface ExportResult {
  readonly exportId: string;
  readonly requestedFormats: NonEmptyExportFormats;
  readonly manifest: ExportManifest;
  readonly manifestChecksum: Sha256;
  readonly archiveChecksum?: Sha256;
  readonly artifacts: readonly ExportArtifact[];
  readonly deliveries: readonly ExportDeliveryReceipt[];
  readonly omissions: readonly ExportOmission[];
  readonly warnings: readonly ValidationFailure[];
  readonly partial: boolean;
  readonly totalBytes: number;
  readonly events: readonly ExportAuditEvent[];
}

/**
 * The failure branch deliberately has no artifact field: cancellation or any
 * blocking failure cannot expose a partial file (EX §22/AC-51).
 */
export type ExportEngineResult =
  | { readonly ok: true; readonly value: ExportResult }
  | {
      readonly ok: false;
      readonly failures: readonly ValidationFailure[];
      readonly cancelled: boolean;
      readonly events: readonly ExportAuditEvent[];
    };

/** Rich asynchronous coordinator boundary; the legacy contract remains unchanged. */
export interface ExportCoordinatorContract {
  export(input: ExportEngineInput): Promise<ExportEngineResult>;
}
