/**
 * Compile-only coverage for the additive Export contracts. Signature assertions
 * protect both the legacy API and the rich coordinator boundary.
 */
import type {
  EngineResult,
  ExportEngineContract,
} from '../../src/shared/contracts/engine-contracts';
import type {
  AnyApplicationDomainEvent,
  BackupCreatedEvent,
  ClipboardCopyCompletedEvent,
  ClipboardCopyFailedEvent,
  ExportAllowlistedSelection,
  ExportArtifact,
  ExportArtifactKind,
  ExportArtifactMediaType,
  ExportAuditEvent,
  ExportBackupType,
  ExportCancellationPort,
  ExportClipboardPayload,
  ExportClipboardPort,
  ExportCompletedEvent,
  ExportCoordinatorContract,
  ExportDeliveryFailure,
  ExportDeliveryFailureCode,
  ExportDeliveryFormat,
  ExportDeliveryPorts,
  ExportDeliveryReceipt,
  ExportDeliveryResult,
  ExportDownloadPort,
  ExportEngineInput,
  ExportEngineResult,
  ExportEngineVersions,
  ExportFailedEvent,
  ExportFileFormat,
  ExportOmission,
  ExportOperationalScope,
  ExportGroupNumberingEntry,
  ExportNumberingEntry,
  ExportPlan,
  ExportPlanOmission,
  ExportPlanResult,
  ExportPlanningContract,
  ExportPlanningFailureCode,
  ExportProgress,
  ExportProgressPort,
  ExportReadOnly,
  ExportRestoreMode,
  ExportResult,
  ExportSafetyLimits,
  ExportSourceSnapshot,
  ExportStage,
  ExportStartedEvent,
  NonEmptyExportFormats,
  RestoreCompletedEvent,
  RestoreFailedEvent,
  RestoreStartedEvent,
} from '../../src/engines/export-engine';
import type {
  ExportFormat,
  ExportManifest,
  ExportScope,
  PhotoshootSession,
} from '../../src/shared/domain-model';

type Ref<T> = T;
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

type LegacySignature = (
  session: PhotoshootSession,
  scope: ExportScope,
  formats: readonly ExportFormat[],
) => EngineResult<ExportManifest>;

export type __ExportContractCoverage = [
  Assert<Equal<ExportEngineContract['export'], LegacySignature>>,
  Assert<
    Equal<
      ExportCoordinatorContract['export'],
      (input: ExportEngineInput) => Promise<ExportEngineResult>
    >
  >,
  Assert<
    Equal<ExportPlanningContract['createPlan'], (input: ExportEngineInput) => ExportPlanResult>
  >,
  Assert<Equal<ExportCancellationPort['isCancellationRequested'], () => boolean>>,
  Assert<Equal<ExportProgressPort['report'], (progress: ExportProgress) => void>>,
  Assert<
    Equal<
      ExportClipboardPort['write'],
      (payload: ExportClipboardPayload) => Promise<ExportDeliveryResult>
    >
  >,
  Assert<
    Equal<
      ExportDownloadPort['deliver'],
      (artifact: ExportArtifact) => Promise<ExportDeliveryResult>
    >
  >,
  Ref<AnyApplicationDomainEvent>,
  Ref<BackupCreatedEvent>,
  Ref<ClipboardCopyCompletedEvent>,
  Ref<ClipboardCopyFailedEvent>,
  Ref<ExportArtifactKind>,
  Ref<ExportArtifactMediaType>,
  Ref<ExportAuditEvent>,
  Ref<ExportAllowlistedSelection>,
  Ref<ExportBackupType>,
  Ref<ExportCompletedEvent>,
  Ref<ExportDeliveryFailure>,
  Ref<ExportDeliveryFailureCode>,
  Ref<ExportDeliveryFormat>,
  Ref<ExportDeliveryPorts>,
  Ref<ExportDeliveryReceipt>,
  Ref<ExportEngineVersions>,
  Ref<ExportFailedEvent>,
  Ref<ExportFileFormat>,
  Ref<ExportOmission>,
  Ref<ExportOperationalScope>,
  Ref<ExportGroupNumberingEntry>,
  Ref<ExportNumberingEntry>,
  Ref<ExportPlan>,
  Ref<ExportPlanOmission>,
  Ref<ExportPlanningFailureCode>,
  Ref<ExportReadOnly<string>>,
  Ref<ExportRestoreMode>,
  Ref<ExportResult>,
  Ref<ExportSafetyLimits>,
  Ref<ExportSourceSnapshot>,
  Ref<ExportStage>,
  Ref<ExportStartedEvent>,
  Ref<NonEmptyExportFormats>,
  Ref<RestoreCompletedEvent>,
  Ref<RestoreFailedEvent>,
  Ref<RestoreStartedEvent>,
];
