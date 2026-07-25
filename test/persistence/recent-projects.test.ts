import { describe, expect, it } from 'vitest';
import type { ProjectId } from '../../src/shared/domain-model';
import {
  InMemoryDeterministicStorageAdapter,
  RecentProjectsStore,
  encodeUtf8,
} from '../../src/persistence';
import { T0, T1, T2 } from './fixtures';

describe('Recent Projects foundation', () => {
  it('deduplicates by project id and orders deterministically', async () => {
    const store = new RecentProjectsStore(new InMemoryDeterministicStorageAdapter());
    await store.record({
      projectId: 'b' as ProjectId,
      name: 'B',
      updatedAt: T0,
      lastOpenedAt: T1,
      schemaVersion: 1,
    });
    await store.record({
      projectId: 'a' as ProjectId,
      name: 'A',
      updatedAt: T1,
      lastOpenedAt: T1,
      schemaVersion: 1,
    });
    const result = await store.record({
      projectId: 'b' as ProjectId,
      name: 'B2',
      updatedAt: T2,
      lastOpenedAt: T2,
      schemaVersion: 1,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((item) => item.projectId)).toEqual(['b', 'a']);
      expect(result.value).toHaveLength(2);
      expect(result.value[0].name).toBe('B2');
    }
  });

  it('stores metadata only and rejects extra project payload', async () => {
    const storage = new InMemoryDeterministicStorageAdapter({
      'recent-projects/index.json': encodeUtf8(
        JSON.stringify([
          {
            projectId: 'a',
            name: 'A',
            updatedAt: T0,
            lastOpenedAt: T0,
            schemaVersion: 1,
            sessions: {},
          },
        ]),
      ),
    });
    const result = await new RecentProjectsStore(storage).list();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CORRUPT_JSON');
  });

  it('removes entries without disturbing deterministic order', async () => {
    const store = new RecentProjectsStore(new InMemoryDeterministicStorageAdapter());
    await store.record({
      projectId: 'a' as ProjectId,
      name: 'A',
      updatedAt: T0,
      lastOpenedAt: T2,
      schemaVersion: 1,
    });
    await store.record({
      projectId: 'b' as ProjectId,
      name: 'B',
      updatedAt: T0,
      lastOpenedAt: T1,
      schemaVersion: 1,
    });
    const result = await store.remove('a' as ProjectId);
    expect(result).toEqual({
      ok: true,
      value: [{ projectId: 'b', name: 'B', updatedAt: T0, lastOpenedAt: T1, schemaVersion: 1 }],
    });
  });
});
