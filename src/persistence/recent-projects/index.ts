import type { IsoTimestamp, Project, ProjectId, SchemaVersion } from '../../shared/domain-model';
import {
  canonicalStringify,
  compareCodeUnits,
  decodeUtf8,
  encodeUtf8,
  fail,
  ok,
  safeJsonParse,
  validateDomainIdentifier,
  type AtomicStorageAdapter,
  type PersistenceResult,
} from '../shared';

const RECENT_KEY = 'recent-projects/index.json';

export interface RecentProjectMetadata {
  readonly projectId: ProjectId;
  readonly name: string;
  readonly updatedAt: IsoTimestamp;
  readonly lastOpenedAt: IsoTimestamp;
  readonly schemaVersion: SchemaVersion;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isMetadata(value: unknown): value is RecentProjectMetadata {
  if (!isObject(value)) return false;
  const allowed = ['lastOpenedAt', 'name', 'projectId', 'schemaVersion', 'updatedAt'];
  if (Object.keys(value).sort().join('|') !== allowed.sort().join('|')) return false;
  return (
    typeof value.projectId === 'string' &&
    value.projectId.length > 0 &&
    typeof value.name === 'string' &&
    typeof value.updatedAt === 'string' &&
    typeof value.lastOpenedAt === 'string' &&
    Number.isInteger(value.schemaVersion)
  );
}

function ordered(items: readonly RecentProjectMetadata[]): readonly RecentProjectMetadata[] {
  return [...items].sort((left, right) => {
    const opened = compareCodeUnits(right.lastOpenedAt, left.lastOpenedAt);
    if (opened !== 0) return opened;
    const updated = compareCodeUnits(right.updatedAt, left.updatedAt);
    if (updated !== 0) return updated;
    return compareCodeUnits(left.projectId, right.projectId);
  });
}

export function recentMetadataFromProject(
  project: Project,
  lastOpenedAt: IsoTimestamp,
): RecentProjectMetadata {
  return {
    projectId: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    lastOpenedAt,
    schemaVersion: project.schemaVersion,
  };
}

export class RecentProjectsStore {
  public constructor(private readonly storage: AtomicStorageAdapter) {}

  public async list(): Promise<PersistenceResult<readonly RecentProjectMetadata[]>> {
    const stored = await this.storage.read(RECENT_KEY);
    if (!stored.ok) return stored;
    if (!stored.value) return ok([]);
    const decoded = decodeUtf8(stored.value);
    if (!decoded.ok) return decoded;
    const parsed = safeJsonParse(decoded.value);
    if (!parsed.ok) return parsed;
    if (!Array.isArray(parsed.value) || !parsed.value.every(isMetadata)) {
      return fail(
        'CORRUPT_JSON',
        'read',
        'Recent-projects index contains invalid or non-metadata data.',
      );
    }
    const deduplicated = new Map<string, RecentProjectMetadata>();
    for (const item of ordered(parsed.value)) {
      if (!deduplicated.has(item.projectId)) deduplicated.set(item.projectId, item);
    }
    return ok(ordered([...deduplicated.values()]));
  }

  public async record(
    metadata: RecentProjectMetadata,
  ): Promise<PersistenceResult<readonly RecentProjectMetadata[]>> {
    if (!isMetadata(metadata)) {
      return fail('VALIDATION_FAILED', 'write', 'Recent project entry must contain metadata only.');
    }
    const validId = validateDomainIdentifier(metadata.projectId, 'projectId');
    if (!validId.ok) return validId;
    const existing = await this.list();
    if (!existing.ok) return existing;
    const byProject = new Map(existing.value.map((item) => [item.projectId, item]));
    byProject.set(metadata.projectId, metadata);
    const next = ordered([...byProject.values()]);
    const serialized = canonicalStringify(next);
    if (!serialized.ok) return serialized;
    const committed = await this.storage.commit([
      { kind: 'put', key: RECENT_KEY, value: encodeUtf8(serialized.value) },
    ]);
    return committed.ok ? ok(next) : committed;
  }

  public async remove(
    projectId: ProjectId,
  ): Promise<PersistenceResult<readonly RecentProjectMetadata[]>> {
    const validId = validateDomainIdentifier(projectId, 'projectId');
    if (!validId.ok) return validId;
    const existing = await this.list();
    if (!existing.ok) return existing;
    const next = existing.value.filter((item) => item.projectId !== projectId);
    const serialized = canonicalStringify(next);
    if (!serialized.ok) return serialized;
    const committed = await this.storage.commit([
      { kind: 'put', key: RECENT_KEY, value: encodeUtf8(serialized.value) },
    ]);
    return committed.ok ? ok(next) : committed;
  }
}
