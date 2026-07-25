import { describe, expect, it } from 'vitest';
import {
  RetentionPolicyKind,
  type IsoTimestamp,
  type VersionId,
} from '../../src/shared/domain-model';
import {
  appendSnapshot,
  applyRetention,
  restoreSnapshot,
  verifySnapshotIntegrity,
} from '../../src/persistence';
import { createProject, T0, T1, T2 } from './fixtures';

describe('append-only version history', () => {
  it('appends snapshots with deterministic parent lineage and stateHash', async () => {
    const first = await appendSnapshot(createProject(), { reason: 'manual_save', timestamp: T0 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await appendSnapshot(
      { ...first.value, name: 'Changed' },
      {
        reason: 'manual_save',
        timestamp: T1,
      },
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.versionOrder).toHaveLength(2);
    const firstId = second.value.versionOrder[0];
    const secondId = second.value.versionOrder[1];
    expect(second.value.versionHistory[secondId].parentVersionId).toBe(firstId);
    expect(second.value.versionHistory[firstId].projectState).toBe(
      first.value.versionHistory[firstId].projectState,
    );
    expect(await verifySnapshotIntegrity(second.value.versionHistory[secondId])).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('produces identical IDs and hashes for identical histories', async () => {
    const left = await appendSnapshot(createProject(), { reason: 'manual_save', timestamp: T0 });
    const right = await appendSnapshot(createProject(), { reason: 'manual_save', timestamp: T2 });
    expect(left.ok && right.ok && left.value.versionOrder).toEqual(
      right.ok ? right.value.versionOrder : [],
    );
    if (left.ok && right.ok) {
      const leftSnapshot = left.value.versionHistory[left.value.versionOrder[0]];
      const rightSnapshot = right.value.versionHistory[right.value.versionOrder[0]];
      expect(leftSnapshot.stateHash).toBe(rightSnapshot.stateHash);
    }
  });

  it('detects tampered snapshot state', async () => {
    const appended = await appendSnapshot(createProject(), {
      reason: 'manual_save',
      timestamp: T0,
    });
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;
    const id = appended.value.versionOrder[0];
    const tampered = {
      ...appended.value.versionHistory[id],
      projectState: '{"id":"tampered"}' as never,
    };
    const verified = await verifySnapshotIntegrity(tampered);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.error.code).toBe('SNAPSHOT_CORRUPT');
  });

  it('safe restore forks from the selected snapshot and preserves all prior snapshots', async () => {
    const first = await appendSnapshot(createProject(), { reason: 'manual_save', timestamp: T0 });
    if (!first.ok) throw new Error('fixture failed');
    const second = await appendSnapshot(
      { ...first.value, name: 'Second' },
      {
        reason: 'manual_save',
        timestamp: T1,
      },
    );
    if (!second.ok) throw new Error('fixture failed');
    const target = second.value.versionOrder[0];
    const restored = await restoreSnapshot(second.value, target, { timestamp: T2 });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value.versionOrder).toHaveLength(3);
    const fork = restored.value.versionOrder[2];
    expect(restored.value.versionHistory[fork].parentVersionId).toBe(target);
    expect(restored.value.name).toBe('Deterministic Project');
  });

  it('fails closed for pruning policies whose lineage compaction is unspecified', async () => {
    let project = createProject();
    for (const [index, timestamp] of [T0, T1, T2].entries()) {
      const next = await appendSnapshot(
        { ...project, name: `P${index}` },
        { reason: 'manual_save', timestamp },
      );
      if (!next.ok) throw new Error('fixture failed');
      project = next.value;
    }
    const sourceOrder = [...project.versionOrder];
    const result = applyRetention(
      { ...project, retention: { kind: RetentionPolicyKind.KeepLastN, keepN: 1 } },
      T2,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('RETENTION_POLICY_UNSUPPORTED');
    expect(project.versionOrder).toEqual(sourceOrder);
    expect(project.versionHistory[project.currentVersionId as VersionId]).toBeDefined();
  });

  it('rejects invalid retention configuration', () => {
    const result = applyRetention(
      createProject({ retention: { kind: RetentionPolicyKind.KeepDays, keepDays: 0 } }),
      T0,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('RETENTION_POLICY_INVALID');
  });

  it('aborts snapshot creation for unsupported pruning without changing source history', async () => {
    const source = createProject({
      retention: { kind: RetentionPolicyKind.KeepLastN, keepN: 1 },
    });
    const before = structuredClone(source);
    const result = await appendSnapshot(source, { reason: 'manual_save', timestamp: T0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('RETENTION_POLICY_UNSUPPORTED');
    expect(source).toEqual(before);
  });

  it('rejects restore from a missing version', async () => {
    const result = await restoreSnapshot(createProject(), 'missing' as VersionId, {
      timestamp: T0 as IsoTimestamp,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SNAPSHOT_NOT_FOUND');
  });
});
