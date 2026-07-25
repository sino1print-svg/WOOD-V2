import type { IsoTimestamp, Project, ProjectId, Sha256 } from '../../shared/domain-model';
import type { AssetStore } from '../asset-store';
import {
  canonicalStringify,
  decodeUtf8,
  deterministicContentHash,
  encodeUtf8,
  fail,
  ok,
  safeJsonParse,
  storageToken,
  validateDomainIdentifier,
  validateProjectDocumentWithAssets,
  type AtomicStorageAdapter,
  type PersistenceResult,
} from '../shared';

interface AutosaveEnvelope {
  readonly schemaVersion: 1;
  readonly projectId: ProjectId;
  readonly savedAt: IsoTimestamp;
  readonly stateHash: Sha256;
  readonly project: Project;
}

export interface CrashMarker {
  readonly schemaVersion: 1;
  readonly projectId: ProjectId;
  readonly markedAt: IsoTimestamp;
  readonly autosaveStateHash: Sha256 | null;
}

export interface AutosaveWriteResult {
  readonly project: Project;
  readonly stateHash: Sha256;
  readonly changed: boolean;
}

async function autosaveKey(projectId: ProjectId): Promise<string> {
  return `recovery/autosave/${await storageToken('project', projectId)}.json`;
}

async function crashMarkerKey(projectId: ProjectId): Promise<string> {
  return `recovery/crash/${await storageToken('project', projectId)}.json`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isAutosaveEnvelope(value: unknown): value is AutosaveEnvelope {
  return (
    isObject(value) &&
    value.schemaVersion === 1 &&
    typeof value.projectId === 'string' &&
    typeof value.savedAt === 'string' &&
    typeof value.stateHash === 'string' &&
    isObject(value.project)
  );
}

function isCrashMarker(value: unknown): value is CrashMarker {
  return (
    isObject(value) &&
    value.schemaVersion === 1 &&
    typeof value.projectId === 'string' &&
    typeof value.markedAt === 'string' &&
    (value.autosaveStateHash === null || typeof value.autosaveStateHash === 'string')
  );
}

export class RecoveryStore {
  public constructor(
    private readonly storage: AtomicStorageAdapter,
    private readonly assets: AssetStore,
  ) {}

  public async writeAutosave(
    project: Project,
    savedAt: IsoTimestamp,
  ): Promise<PersistenceResult<AutosaveWriteResult>> {
    const validated = await validateProjectDocumentWithAssets(project, this.assets);
    if (!validated.ok) return validated;
    const projectJson = canonicalStringify(validated.value);
    if (!projectJson.ok) return projectJson;
    const stateHashResult = await deterministicContentHash(validated.value);
    if (!stateHashResult.ok) return stateHashResult;
    const stateHash = stateHashResult.value as Sha256;
    const key = await autosaveKey(project.id);
    const existing = await this.storage.read(key);
    if (!existing.ok) return existing;
    if (existing.value) {
      const decoded = decodeUtf8(existing.value);
      if (!decoded.ok) return decoded;
      const parsed = safeJsonParse(decoded.value);
      if (!parsed.ok || !isAutosaveEnvelope(parsed.value)) {
        return fail('CORRUPT_JSON', 'autosave', {
          messageEn: 'The autosave slot is corrupt.',
          messageAr: 'فتحة الحفظ التلقائي تالفة.',
        });
      }
      if (parsed.value.stateHash === stateHash) {
        return ok({ project: validated.value, stateHash, changed: false });
      }
    }
    const envelope: AutosaveEnvelope = {
      schemaVersion: 1,
      projectId: project.id,
      savedAt,
      stateHash,
      project: validated.value,
    };
    const serialized = canonicalStringify(envelope);
    if (!serialized.ok) return serialized;
    const committed = await this.storage.commit([
      { kind: 'put', key, value: encodeUtf8(serialized.value) },
    ]);
    return committed.ok ? ok({ project: validated.value, stateHash, changed: true }) : committed;
  }

  public async loadAutosave(projectId: ProjectId): Promise<PersistenceResult<AutosaveWriteResult>> {
    const validId = validateDomainIdentifier(projectId, 'projectId');
    if (!validId.ok) return validId;
    const stored = await this.storage.read(await autosaveKey(projectId));
    if (!stored.ok) return stored;
    if (!stored.value) return fail('AUTOSAVE_NOT_FOUND', 'autosave');
    const decoded = decodeUtf8(stored.value);
    if (!decoded.ok) return decoded;
    const parsed = safeJsonParse(decoded.value);
    if (!parsed.ok) return parsed;
    if (!isAutosaveEnvelope(parsed.value) || parsed.value.projectId !== projectId) {
      return fail('CORRUPT_JSON', 'autosave', {
        messageEn: 'The autosave envelope is malformed or belongs to another project.',
        messageAr: 'غلاف الحفظ التلقائي غير صالح أو تابع لمشروع آخر.',
      });
    }
    const validated = await validateProjectDocumentWithAssets(parsed.value.project, this.assets);
    if (!validated.ok) return validated;
    const canonical = canonicalStringify(validated.value);
    if (!canonical.ok) return canonical;
    const actualHashResult = await deterministicContentHash(validated.value);
    if (!actualHashResult.ok) return actualHashResult;
    const actualHash = actualHashResult.value as Sha256;
    if (actualHash !== parsed.value.stateHash) {
      return fail('SNAPSHOT_CORRUPT', 'autosave', {
        details: { expectedHash: parsed.value.stateHash, actualHash },
      });
    }
    return ok({ project: validated.value, stateHash: actualHash, changed: false });
  }

  public async clearAutosave(projectId: ProjectId): Promise<PersistenceResult<void>> {
    const validId = validateDomainIdentifier(projectId, 'projectId');
    if (!validId.ok) return validId;
    return this.storage.commit([{ kind: 'delete', key: await autosaveKey(projectId) }]);
  }

  public async markCrash(
    projectId: ProjectId,
    markedAt: IsoTimestamp,
    autosaveStateHash: Sha256 | null,
  ): Promise<PersistenceResult<CrashMarker>> {
    const validId = validateDomainIdentifier(projectId, 'projectId');
    if (!validId.ok) return validId;
    const marker: CrashMarker = {
      schemaVersion: 1,
      projectId,
      markedAt,
      autosaveStateHash,
    };
    const serialized = canonicalStringify(marker);
    if (!serialized.ok) return serialized;
    const committed = await this.storage.commit([
      { kind: 'put', key: await crashMarkerKey(projectId), value: encodeUtf8(serialized.value) },
    ]);
    return committed.ok ? ok(marker) : committed;
  }

  public async readCrashMarker(
    projectId: ProjectId,
  ): Promise<PersistenceResult<CrashMarker | null>> {
    const validId = validateDomainIdentifier(projectId, 'projectId');
    if (!validId.ok) return validId;
    const stored = await this.storage.read(await crashMarkerKey(projectId));
    if (!stored.ok) return stored;
    if (!stored.value) return ok(null);
    const decoded = decodeUtf8(stored.value);
    if (!decoded.ok) return decoded;
    const parsed = safeJsonParse(decoded.value);
    if (!parsed.ok) return parsed;
    if (!isCrashMarker(parsed.value) || parsed.value.projectId !== projectId) {
      return fail('CORRUPT_JSON', 'recovery', {
        messageEn: 'The crash marker is malformed or belongs to another project.',
        messageAr: 'علامة التعطل غير صالحة أو تابعة لمشروع آخر.',
      });
    }
    return ok(parsed.value);
  }

  public async clearCrashMarker(projectId: ProjectId): Promise<PersistenceResult<void>> {
    const validId = validateDomainIdentifier(projectId, 'projectId');
    if (!validId.ok) return validId;
    return this.storage.commit([{ kind: 'delete', key: await crashMarkerKey(projectId) }]);
  }
}
