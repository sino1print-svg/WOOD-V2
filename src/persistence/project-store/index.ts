import type {
  IsoTimestamp,
  Project,
  ProjectId,
  VersionId,
  VersionSnapshot,
} from '../../shared/domain-model';
import { AssetStore } from '../asset-store';
import { appendSnapshot, verifySnapshotIntegrity } from '../version-history';
import {
  canonicalStringify,
  decodeUtf8,
  encodeUtf8,
  fail,
  legacyProjectStorageKey,
  migrateProjectDocument,
  ok,
  projectStorageKey,
  safeJsonParse,
  storageToken,
  validateDomainIdentifier,
  validateProjectDocument,
  validateProjectDocumentWithAssets,
  type AtomicStorageAdapter,
  type PersistenceResult,
  type StorageOperation,
} from '../shared';

export interface SaveProjectOptions {
  readonly overwrite: boolean;
  readonly timestamp: IsoTimestamp;
  readonly reason?: VersionSnapshot['reason'];
}

export interface RenameProjectOptions {
  readonly name: string;
  readonly timestamp: IsoTimestamp;
}

export interface LoadProjectResult {
  readonly project: Project;
  readonly migrated: boolean;
  readonly recovered: boolean;
}

interface LocatedProject {
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly isLegacyKey: boolean;
}

interface SnapshotJournalIndex {
  readonly projectId: ProjectId;
  readonly currentVersionId: VersionId;
  readonly versionOrder: readonly VersionId[];
}

async function snapshotIndexKey(projectId: ProjectId): Promise<string> {
  const token = await storageToken('project', projectId);
  return `snapshots/by-project/${token}/index.json`;
}

async function snapshotKey(projectId: ProjectId, versionId: VersionId): Promise<string> {
  const projectToken = await storageToken('project', projectId);
  const versionToken = await storageToken('version', versionId);
  return `snapshots/by-project/${projectToken}/items/${versionToken}.json`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isJournalIndex(value: unknown): value is SnapshotJournalIndex {
  return (
    isObject(value) &&
    typeof value.projectId === 'string' &&
    typeof value.currentVersionId === 'string' &&
    Array.isArray(value.versionOrder) &&
    value.versionOrder.every((item) => typeof item === 'string')
  );
}

function isVersionSnapshot(value: unknown): value is VersionSnapshot {
  return (
    isObject(value) &&
    typeof value.versionId === 'string' &&
    typeof value.projectId === 'string' &&
    typeof value.timestamp === 'string' &&
    (value.parentVersionId === null || typeof value.parentVersionId === 'string') &&
    typeof value.projectState === 'string' &&
    typeof value.reason === 'string' &&
    typeof value.stateHash === 'string'
  );
}

export function serializeProject(project: Project): PersistenceResult<string> {
  const validation = validateProjectDocument(project);
  if (!validation.ok) return validation;
  return canonicalStringify(project);
}

export async function deserializeProject(
  text: string,
): Promise<PersistenceResult<LoadProjectResult>> {
  const parsed = safeJsonParse(text);
  if (!parsed.ok) return parsed;
  const migrated = await migrateProjectDocument(parsed.value);
  if (!migrated.ok) return migrated;

  for (const versionId of migrated.value.value.versionOrder) {
    const snapshot = migrated.value.value.versionHistory[versionId];
    const integrity = await verifySnapshotIntegrity(snapshot);
    if (!integrity.ok) return integrity;
  }
  return ok({ project: migrated.value.value, migrated: migrated.value.changed, recovered: false });
}

export class ProjectStore {
  private readonly assets: AssetStore;

  public constructor(
    private readonly storage: AtomicStorageAdapter,
    assetStore?: AssetStore,
  ) {
    this.assets = assetStore ?? new AssetStore(storage);
  }

  private async locate(projectId: ProjectId): Promise<PersistenceResult<LocatedProject | null>> {
    const currentKey = await projectStorageKey(projectId);
    const current = await this.storage.read(currentKey);
    if (!current.ok) return current;
    if (current.value) return ok({ key: currentKey, bytes: current.value, isLegacyKey: false });
    const legacyKey = legacyProjectStorageKey(projectId);
    if (!legacyKey) return ok(null);
    const legacy = await this.storage.read(legacyKey);
    if (!legacy.ok) return legacy;
    return ok(legacy.value ? { key: legacyKey, bytes: legacy.value, isLegacyKey: true } : null);
  }

  public async exists(projectId: ProjectId): Promise<PersistenceResult<boolean>> {
    const valid = validateDomainIdentifier(projectId, 'projectId');
    if (!valid.ok) return valid;
    const located = await this.locate(projectId);
    return located.ok ? ok(located.value !== null) : located;
  }

  private async journalOperations(
    project: Project,
  ): Promise<PersistenceResult<StorageOperation[]>> {
    if (!project.currentVersionId) {
      return fail('VALIDATION_FAILED', 'snapshot', {
        messageEn: 'A persisted project must have a current VersionSnapshot.',
        messageAr: 'يجب أن يحتوي المشروع المحفوظ على لقطة إصدار حالية.',
      });
    }
    const snapshot = project.versionHistory[project.currentVersionId];
    if (!snapshot) return fail('SNAPSHOT_NOT_FOUND', 'snapshot');
    const snapshotSerialized = canonicalStringify(snapshot);
    if (!snapshotSerialized.ok) return snapshotSerialized;
    const index: SnapshotJournalIndex = {
      projectId: project.id,
      currentVersionId: project.currentVersionId,
      versionOrder: project.versionOrder,
    };
    const indexSerialized = canonicalStringify(index);
    if (!indexSerialized.ok) return indexSerialized;
    return ok([
      {
        kind: 'put',
        key: await snapshotKey(project.id, snapshot.versionId),
        value: encodeUtf8(snapshotSerialized.value),
        requireAbsent: true,
      },
      {
        kind: 'put',
        key: await snapshotIndexKey(project.id),
        value: encodeUtf8(indexSerialized.value),
      },
    ]);
  }

  private async backfillJournalOperations(
    project: Project,
  ): Promise<PersistenceResult<StorageOperation[]>> {
    const operations: StorageOperation[] = [];
    for (const versionId of project.versionOrder) {
      const serialized = canonicalStringify(project.versionHistory[versionId]);
      if (!serialized.ok) return serialized;
      operations.push({
        kind: 'put',
        key: await snapshotKey(project.id, versionId),
        value: encodeUtf8(serialized.value),
      });
    }
    if (project.currentVersionId) {
      const index: SnapshotJournalIndex = {
        projectId: project.id,
        currentVersionId: project.currentVersionId,
        versionOrder: project.versionOrder,
      };
      const serialized = canonicalStringify(index);
      if (!serialized.ok) return serialized;
      operations.push({
        kind: 'put',
        key: await snapshotIndexKey(project.id),
        value: encodeUtf8(serialized.value),
      });
    }
    return ok(operations);
  }

  public async save(
    project: Project,
    options: SaveProjectOptions,
  ): Promise<PersistenceResult<Project>> {
    const validId = validateDomainIdentifier(project.id, 'projectId');
    if (!validId.ok) return validId;
    const located = await this.locate(project.id);
    if (!located.ok) return located;
    if (located.value && !options.overwrite)
      return fail('OVERWRITE_REQUIRED', 'write', {
        details: { projectId: project.id },
      });
    if (located.value && options.overwrite) {
      const existingText = decodeUtf8(located.value.bytes);
      if (!existingText.ok) return existingText;
      const existing = await deserializeProject(existingText.value);
      if (!existing.ok) return existing;
      const incomingHistory = canonicalStringify({
        currentVersionId: project.currentVersionId,
        versionHistory: project.versionHistory,
        versionOrder: project.versionOrder,
      });
      if (!incomingHistory.ok) return incomingHistory;
      const storedHistory = canonicalStringify({
        currentVersionId: existing.value.project.currentVersionId,
        versionHistory: existing.value.project.versionHistory,
        versionOrder: existing.value.project.versionOrder,
      });
      if (!storedHistory.ok) return storedHistory;
      if (incomingHistory.value !== storedHistory.value) {
        return fail('VALIDATION_FAILED', 'write', {
          messageEn:
            'Overwrite was rejected because the supplied version history is stale or incomplete.',
          messageAr: 'رُفض الاستبدال لأن سجل الإصدارات المرسل قديم أو غير مكتمل.',
          details: { blocker: 'VERSION_HISTORY_CONFLICT' },
        });
      }
    }

    const preValidation = await validateProjectDocumentWithAssets(project, this.assets);
    if (!preValidation.ok) return preValidation;
    const snapshotted = await appendSnapshot(preValidation.value, {
      reason: options.reason ?? 'manual_save',
      timestamp: options.timestamp,
    });
    if (!snapshotted.ok) return snapshotted;
    const postValidation = await validateProjectDocumentWithAssets(snapshotted.value, this.assets);
    if (!postValidation.ok) return postValidation;

    const serialized = serializeProject(postValidation.value);
    if (!serialized.ok) return serialized;
    const currentKey = await projectStorageKey(project.id);
    const currentExists = await this.storage.exists(currentKey);
    if (!currentExists.ok) return currentExists;
    const journal = await this.journalOperations(postValidation.value);
    if (!journal.ok) return journal;
    const operations: StorageOperation[] = [
      {
        kind: 'put',
        key: currentKey,
        value: encodeUtf8(serialized.value),
        requireAbsent: !currentExists.value,
      },
      ...journal.value,
    ];
    if (located.value?.isLegacyKey) {
      operations.push({ kind: 'delete', key: located.value.key, requirePresent: true });
    }
    const committed = await this.storage.commit(operations);
    if (!committed.ok) {
      return fail('STORAGE_FAILURE', 'write', {
        messageEn: committed.error.messageEn,
        messageAr: committed.error.messageAr,
        retryable: committed.error.retryable,
        details: committed.error.details,
      });
    }
    return ok(postValidation.value);
  }

  public async load(projectId: ProjectId): Promise<PersistenceResult<LoadProjectResult>> {
    const valid = validateDomainIdentifier(projectId, 'projectId');
    if (!valid.ok) return valid;
    const located = await this.locate(projectId);
    if (!located.ok) return located;
    if (!located.value) return fail('PROJECT_NOT_FOUND', 'read', { details: { projectId } });
    const decoded = decodeUtf8(located.value.bytes);
    if (!decoded.ok) return decoded;
    const loaded = await deserializeProject(decoded.value);
    if (!loaded.ok) return loaded;
    if (loaded.value.project.id !== projectId) {
      return fail('VALIDATION_FAILED', 'read', {
        messageEn: 'Stored project id does not match the requested project.',
        messageAr: 'معرّف المشروع المحفوظ لا يطابق المشروع المطلوب.',
      });
    }
    const storageValidation = await validateProjectDocumentWithAssets(
      loaded.value.project,
      this.assets,
    );
    if (!storageValidation.ok) return storageValidation;

    if (loaded.value.migrated || located.value.isLegacyKey) {
      const serialized = serializeProject(storageValidation.value);
      if (!serialized.ok) return serialized;
      const currentKey = await projectStorageKey(projectId);
      const journal = await this.backfillJournalOperations(storageValidation.value);
      if (!journal.ok) return journal;
      const operations: StorageOperation[] = [
        { kind: 'put', key: currentKey, value: encodeUtf8(serialized.value) },
        ...journal.value,
      ];
      if (located.value.isLegacyKey) {
        operations.push({ kind: 'delete', key: located.value.key, requirePresent: true });
      }
      const writeBack = await this.storage.commit(operations);
      if (!writeBack.ok)
        return fail('STORAGE_FAILURE', 'write', {
          messageEn: 'Migrated project could not be written back safely.',
          messageAr: 'تعذر حفظ المشروع المُرحّل بصورة ذرية وآمنة.',
          retryable: true,
          details: { causeCategory: writeBack.error.causeCategory },
        });
    } else {
      const indexExists = await this.storage.exists(await snapshotIndexKey(projectId));
      if (!indexExists.ok) return indexExists;
      if (!indexExists.value && storageValidation.value.versionOrder.length > 0) {
        const journal = await this.backfillJournalOperations(storageValidation.value);
        if (!journal.ok) return journal;
        const commit = await this.storage.commit(journal.value);
        if (!commit.ok) return commit;
      }
    }
    return ok({
      project: storageValidation.value,
      migrated: loaded.value.migrated,
      recovered: false,
    });
  }

  public async rename(
    projectId: ProjectId,
    options: RenameProjectOptions,
  ): Promise<PersistenceResult<Project>> {
    const loaded = await this.load(projectId);
    if (!loaded.ok) return loaded;
    const renamed: Project = {
      ...loaded.value.project,
      name: options.name,
      updatedAt: options.timestamp,
    };
    return this.save(renamed, { overwrite: true, timestamp: options.timestamp });
  }

  public async recoverLatestValidSnapshot(
    projectId: ProjectId,
  ): Promise<PersistenceResult<LoadProjectResult>> {
    const valid = validateDomainIdentifier(projectId, 'projectId');
    if (!valid.ok) return valid;
    const storedIndex = await this.storage.read(await snapshotIndexKey(projectId));
    if (!storedIndex.ok) return storedIndex;
    if (!storedIndex.value) return fail('RECOVERY_NOT_AVAILABLE', 'recovery');
    const indexText = decodeUtf8(storedIndex.value);
    if (!indexText.ok) return fail('RECOVERY_NOT_AVAILABLE', 'recovery');
    const parsedIndex = safeJsonParse(indexText.value);
    if (
      !parsedIndex.ok ||
      !isJournalIndex(parsedIndex.value) ||
      parsedIndex.value.projectId !== projectId
    ) {
      return fail('RECOVERY_NOT_AVAILABLE', 'recovery');
    }

    const history: Record<string, VersionSnapshot> = Object.create(null) as Record<
      string,
      VersionSnapshot
    >;
    const order: VersionId[] = [];
    for (const versionId of parsedIndex.value.versionOrder) {
      const stored = await this.storage.read(await snapshotKey(projectId, versionId));
      if (!stored.ok || !stored.value) continue;
      const decoded = decodeUtf8(stored.value);
      if (!decoded.ok) continue;
      const parsed = safeJsonParse(decoded.value);
      if (!parsed.ok || !isVersionSnapshot(parsed.value)) continue;
      if (parsed.value.projectId !== projectId || parsed.value.versionId !== versionId) continue;
      if (parsed.value.parentVersionId !== null && !history[parsed.value.parentVersionId]) continue;
      const integrity = await verifySnapshotIntegrity(parsed.value);
      if (!integrity.ok) continue;
      history[versionId] = parsed.value;
      order.push(versionId);
    }
    const latestId = order.at(-1);
    if (!latestId) return fail('RECOVERY_NOT_AVAILABLE', 'recovery');
    const state = safeJsonParse(history[latestId].projectState);
    if (!state.ok || !isObject(state.value)) return fail('RECOVERY_NOT_AVAILABLE', 'recovery');
    const candidate = {
      ...state.value,
      currentVersionId: latestId,
      versionHistory: history,
      versionOrder: order,
    };
    const validated = await validateProjectDocumentWithAssets(candidate, this.assets);
    if (!validated.ok)
      return fail('RESTORE_FAILED', 'recovery', {
        details: { causeCode: validated.error.code },
      });
    const serialized = serializeProject(validated.value);
    if (!serialized.ok) return serialized;
    const commit = await this.storage.commit([
      {
        kind: 'put',
        key: await projectStorageKey(projectId),
        value: encodeUtf8(serialized.value),
      },
    ]);
    if (!commit.ok) return commit;
    return ok({ project: validated.value, migrated: false, recovered: true });
  }
}
