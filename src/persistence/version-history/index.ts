import type {
  IsoTimestamp,
  Project,
  SerializedProjectState,
  Sha256,
  VersionId,
  VersionSnapshot,
} from '../../shared/domain-model';
import { RetentionPolicyKind } from '../../shared/domain-model';
import {
  canonicalStringify,
  deterministicContentHash,
  fail,
  ok,
  safeJsonParse,
  type PersistenceResult,
  validateProjectDocument,
} from '../shared';

export interface AppendSnapshotOptions {
  readonly reason: VersionSnapshot['reason'];
  readonly timestamp: IsoTimestamp;
  readonly parentVersionId?: VersionId | null;
}

export interface RestoreSnapshotOptions {
  readonly timestamp: IsoTimestamp;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function snapshotStateObject(project: Project): Record<string, unknown> {
  const state = { ...project } as unknown as Record<string, unknown>;
  delete state.versionHistory;
  delete state.versionOrder;
  delete state.currentVersionId;
  return state;
}

export function serializeProjectState(project: Project): PersistenceResult<SerializedProjectState> {
  const serialized = canonicalStringify(snapshotStateObject(project));
  return serialized.ok ? ok(serialized.value as SerializedProjectState) : serialized;
}

export async function verifySnapshotIntegrity(
  snapshot: VersionSnapshot,
): Promise<PersistenceResult<void>> {
  if (!snapshot.stateHash) {
    return fail('SNAPSHOT_CORRUPT', 'snapshot', 'Snapshot is missing stateHash.', false, {
      versionId: snapshot.versionId,
    });
  }
  const parsed = safeJsonParse(snapshot.projectState);
  if (!parsed.ok) return fail('SNAPSHOT_CORRUPT', 'snapshot', parsed.error.message);
  const canonical = canonicalStringify(parsed.value);
  if (!canonical.ok || canonical.value !== snapshot.projectState) {
    return fail('SNAPSHOT_CORRUPT', 'snapshot', 'Snapshot state is not canonical JSON.');
  }
  const hash = await deterministicContentHash(parsed.value);
  if (!hash.ok || hash.value !== snapshot.stateHash) {
    return fail(
      'SNAPSHOT_CORRUPT',
      'snapshot',
      'Snapshot stateHash does not match its state.',
      false,
      {
        versionId: snapshot.versionId,
      },
    );
  }
  return ok(undefined);
}

async function nextVersionId(
  stateHash: Sha256,
  parentVersionId: VersionId | null,
  reason: VersionSnapshot['reason'],
  ordinal: number,
): Promise<VersionId> {
  const digest = await deterministicContentHash({ stateHash, parentVersionId, reason, ordinal });
  const token = digest.ok ? digest.value.slice(0, 20) : stateHash.slice(0, 20);
  return `version:${ordinal.toString().padStart(6, '0')}:${token}` as VersionId;
}

export function applyRetention(project: Project, now: IsoTimestamp): PersistenceResult<Project> {
  const { retention } = project;
  if (retention.kind === RetentionPolicyKind.KeepAll) return ok(project);

  if (retention.kind === RetentionPolicyKind.KeepLastN) {
    if (!Number.isInteger(retention.keepN) || (retention.keepN ?? 0) < 1) {
      return fail('RETENTION_POLICY_INVALID', 'retention', {
        messageEn: 'keepN must be a positive integer.',
        messageAr: 'يجب أن تكون قيمة keepN عددًا صحيحًا موجبًا.',
      });
    }
  } else if (retention.kind === RetentionPolicyKind.KeepDays) {
    if (
      typeof retention.keepDays !== 'number' ||
      !Number.isInteger(retention.keepDays) ||
      retention.keepDays < 1 ||
      !Number.isFinite(Date.parse(now))
    ) {
      return fail('RETENTION_POLICY_INVALID', 'retention', {
        messageEn: 'keepDays and the retention timestamp must be valid.',
        messageAr: 'يجب أن تكون keepDays ووقت تطبيق الاحتفاظ صالحين.',
      });
    }
  }

  // SPECIFICATION_BLOCKER: the authoritative documents require immutable append-only
  // parent lineage, non-dangling parents and pruning, but define no re-parenting,
  // checkpoint, diff or compaction algorithm. Failing closed preserves all data.
  return fail('RETENTION_POLICY_UNSUPPORTED', 'retention', {
    details: {
      policy: retention.kind,
      blocker: 'RETENTION_LINEAGE_COMPACTION_UNDEFINED',
    },
  });
}

export async function appendSnapshot(
  project: Project,
  options: AppendSnapshotOptions,
): Promise<PersistenceResult<Project>> {
  const serialized = serializeProjectState(project);
  if (!serialized.ok) return serialized;
  const parsed = safeJsonParse(serialized.value);
  if (!parsed.ok) return parsed;
  const stateHashResult = await deterministicContentHash(parsed.value);
  if (!stateHashResult.ok) return stateHashResult;

  const parentVersionId = options.parentVersionId ?? project.currentVersionId;
  if (parentVersionId && !project.versionHistory[parentVersionId]) {
    return fail('SNAPSHOT_NOT_FOUND', 'snapshot', 'Snapshot parent does not exist.', false, {
      parentVersionId,
    });
  }
  const versionId = await nextVersionId(
    stateHashResult.value,
    parentVersionId,
    options.reason,
    project.versionOrder.length + 1,
  );
  if (project.versionHistory[versionId]) {
    return fail('VALIDATION_FAILED', 'snapshot', 'Deterministic version id collision.');
  }
  const snapshot: VersionSnapshot = Object.freeze({
    versionId,
    projectId: project.id,
    timestamp: options.timestamp,
    parentVersionId,
    projectState: serialized.value,
    reason: options.reason,
    stateHash: stateHashResult.value,
  });
  const next: Project = {
    ...project,
    currentVersionId: versionId,
    versionHistory: { ...project.versionHistory, [versionId]: snapshot },
    versionOrder: [...project.versionOrder, versionId],
  };
  return applyRetention(next, options.timestamp);
}

export async function restoreSnapshot(
  project: Project,
  versionId: VersionId,
  options: RestoreSnapshotOptions,
): Promise<PersistenceResult<Project>> {
  const snapshot = project.versionHistory[versionId];
  if (!snapshot)
    return fail('SNAPSHOT_NOT_FOUND', 'restore', 'Snapshot does not exist.', false, { versionId });
  if (snapshot.projectId !== project.id) {
    return fail('RESTORE_FAILED', 'restore', 'Cross-project snapshot restore is forbidden.');
  }
  const integrity = await verifySnapshotIntegrity(snapshot);
  if (!integrity.ok) return integrity;
  const parsed = safeJsonParse(snapshot.projectState);
  if (!parsed.ok || !isObject(parsed.value)) {
    return fail('SNAPSHOT_CORRUPT', 'restore', 'Snapshot state is not a project object.');
  }

  const restoredCandidate = {
    ...parsed.value,
    currentVersionId: versionId,
    versionHistory: project.versionHistory,
    versionOrder: project.versionOrder,
  };
  const validated = validateProjectDocument(restoredCandidate);
  if (!validated.ok)
    return fail(
      'RESTORE_FAILED',
      'restore',
      validated.error.message,
      false,
      validated.error.details,
    );

  // Restore always forks from the selected snapshot; the selected snapshot remains immutable.
  return appendSnapshot(validated.value, {
    reason: 'manual_save',
    timestamp: options.timestamp,
    parentVersionId: versionId,
  });
}
