import { describe, expect, it } from 'vitest';
import { InMemoryDeterministicStorageAdapter, ProjectStore } from '../../src/persistence';
import { RetentionPolicyKind, type SessionId } from '../../src/shared/domain-model';
import { createNestedProject, createProject, PROJECT_ID, T0, T1 } from './fixtures';

const SESSION_ID = 'جلسة-001' as SessionId;

describe('Phase 1 project operations', () => {
  it('rename is a manual save, appends a snapshot and does not change session fingerprint', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    const store = new ProjectStore(storage);
    const first = await store.save(createNestedProject(), { overwrite: false, timestamp: T0 });
    if (!first.ok) throw new Error('fixture failed');
    const fingerprint = first.value.sessions[SESSION_ID].fingerprint;
    const renamed = await store.rename(PROJECT_ID, { name: 'اسم جديد', timestamp: T1 });
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.value.name).toBe('اسم جديد');
    expect(renamed.value.versionOrder).toHaveLength(2);
    expect(renamed.value.sessions[SESSION_ID].fingerprint).toEqual(fingerprint);
  });

  it('failed snapshot/retention aborts the entire first public save', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    const store = new ProjectStore(storage);
    const result = await store.save(
      createProject({ retention: { kind: RetentionPolicyKind.KeepLastN, keepN: 1 } }),
      { overwrite: false, timestamp: T0 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('RETENTION_POLICY_UNSUPPORTED');
    expect(storage.dump()).toEqual({});
  });
});
