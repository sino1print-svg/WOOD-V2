import { describe, expect, it } from 'vitest';
import type { ProjectId } from '../../src/shared/domain-model';
import {
  InMemoryDeterministicStorageAdapter,
  ProjectStore,
  decodeUtf8,
  encodeUtf8,
  serializeProject,
  projectStorageKey,
} from '../../src/persistence';
import { createProject, PROJECT_ID, T0, T1 } from './fixtures';

describe('ProjectStore', () => {
  it('saves, creates a snapshot, exists, and loads canonical state', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    const store = new ProjectStore(storage);
    const saved = await store.save(createProject(), { overwrite: false, timestamp: T1 });
    expect(saved.ok).toBe(true);
    expect(await store.exists(PROJECT_ID)).toEqual({ ok: true, value: true });
    const loaded = await store.load(PROJECT_ID);
    expect(loaded.ok).toBe(true);
    if (saved.ok && loaded.ok) {
      expect(loaded.value.project).toEqual(saved.value);
      expect(loaded.value.project.versionOrder).toHaveLength(1);
      expect(loaded.value.project.currentVersionId).toBe(loaded.value.project.versionOrder[0]);
    }
  });

  it('requires explicit overwrite approval', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    const store = new ProjectStore(storage);
    expect((await store.save(createProject(), { overwrite: false, timestamp: T0 })).ok).toBe(true);
    const refused = await store.save(createProject(), { overwrite: false, timestamp: T1 });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe('OVERWRITE_REQUIRED');
  });

  it('returns a typed missing-project failure', async () => {
    const store = new ProjectStore(new InMemoryDeterministicStorageAdapter());
    const result = await store.load('missing' as ProjectId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROJECT_NOT_FOUND');
  });

  it('rejects corrupt JSON and newer schema versions without mutation', async () => {
    const storage = new InMemoryDeterministicStorageAdapter({
      'projects/project-001.json': encodeUtf8('{broken'),
    });
    const store = new ProjectStore(storage);
    const corrupt = await store.load(PROJECT_ID);
    expect(corrupt.ok).toBe(false);
    if (!corrupt.ok) expect(corrupt.error.code).toBe('CORRUPT_JSON');

    const newer = { ...createProject(), schemaVersion: 2 };
    storage.setFaultPlan(null);
    await storage.commit([
      { kind: 'put', key: 'projects/project-001.json', value: encodeUtf8(JSON.stringify(newer)) },
    ]);
    const key = await projectStorageKey(PROJECT_ID);
    const before = storage.dump()[key];
    const refused = await store.load(PROJECT_ID);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe('UNSUPPORTED_SCHEMA_VERSION');
    expect(storage.dump()[key]).toEqual(before);
  });

  it('validates before save and forbids absolute paths/raw project asset bytes', async () => {
    const store = new ProjectStore(new InMemoryDeterministicStorageAdapter());
    const invalid = createProject({ ownerRef: 'C:\\secret\\owner-token' });
    const result = await store.save(invalid, { overwrite: false, timestamp: T0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
  });

  it('leaves prior bytes unchanged on an injected save failure', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    const store = new ProjectStore(storage);
    const first = await store.save(createProject(), { overwrite: false, timestamp: T0 });
    expect(first.ok).toBe(true);
    const key = await projectStorageKey(PROJECT_ID);
    const before = storage.dump()[key];
    storage.setFaultPlan({ failCommitNumber: 2, failAfterOperation: 1 });
    const second = await store.save(createProject({ name: 'Changed' }), {
      overwrite: true,
      timestamp: T1,
    });
    expect(second.ok).toBe(false);
    expect(storage.dump()[key]).toEqual(before);
  });

  it('serializes identical projects to byte-identical canonical JSON', () => {
    const a = serializeProject(createProject());
    const b = serializeProject({ ...createProject(), artworks: {}, sessions: {} });
    expect(a).toEqual(b);
  });

  it('stored project JSON contains metadata references but no raw PNG bytes', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    const store = new ProjectStore(storage);
    expect((await store.save(createProject(), { overwrite: false, timestamp: T0 })).ok).toBe(true);
    const raw = storage.dump()[await projectStorageKey(PROJECT_ID)];
    const decoded = decodeUtf8(raw);
    expect(decoded.ok && decoded.value.includes('Uint8Array')).toBe(false);
    expect(decoded.ok && decoded.value.startsWith('{')).toBe(true);
  });
});
