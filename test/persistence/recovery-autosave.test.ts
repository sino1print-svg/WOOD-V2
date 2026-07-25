import { describe, expect, it } from 'vitest';
import type { ProjectId } from '../../src/shared/domain-model';
import {
  AssetStore,
  InMemoryDeterministicStorageAdapter,
  ProjectStore,
  RecoveryStore,
  projectStorageKey,
} from '../../src/persistence';
import { createProject, PROJECT_ID, T0, T1 } from './fixtures';

describe('Phase 1 autosave slot and crash-marker foundation', () => {
  it('writes autosave to an independent slot without creating or overwriting manual project bytes', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    const assets = new AssetStore(storage);
    const recovery = new RecoveryStore(storage, assets);
    const projects = new ProjectStore(storage, assets);
    const manual = await projects.save(createProject(), { overwrite: false, timestamp: T0 });
    if (!manual.ok) throw new Error('fixture failed');
    const manualKey = await projectStorageKey(PROJECT_ID);
    const before = storage.dump()[manualKey];
    const autosave = await recovery.writeAutosave(
      { ...manual.value, name: 'Unsaved edit', updatedAt: T1 },
      T1,
    );
    expect(autosave.ok && autosave.value.changed).toBe(true);
    expect(storage.dump()[manualKey]).toEqual(before);
    expect(Object.keys(storage.dump()).some((key) => key.startsWith('recovery/autosave/'))).toBe(
      true,
    );
  });

  it('does not churn autosave bytes for timestamp-only changes', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    const recovery = new RecoveryStore(storage, new AssetStore(storage));
    const first = await recovery.writeAutosave(createProject(), T0);
    expect(first.ok && first.value.changed).toBe(true);
    const before = storage.dump();
    const second = await recovery.writeAutosave(createProject({ updatedAt: T1 }), T1);
    expect(second.ok && second.value.changed).toBe(false);
    expect(storage.dump()).toEqual(before);
  });

  it('loads and verifies an autosave, then clears it explicitly', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    const recovery = new RecoveryStore(storage, new AssetStore(storage));
    const written = await recovery.writeAutosave(createProject({ name: 'Autosaved' }), T0);
    if (!written.ok) throw new Error('fixture failed');
    const loaded = await recovery.loadAutosave(PROJECT_ID);
    expect(loaded.ok && loaded.value.project.name).toBe('Autosaved');
    expect(await recovery.clearAutosave(PROJECT_ID)).toEqual({ ok: true, value: undefined });
    const missing = await recovery.loadAutosave(PROJECT_ID);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('AUTOSAVE_NOT_FOUND');
  });

  it('persists, reads and clears a crash marker without applying recovery automatically', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    const recovery = new RecoveryStore(storage, new AssetStore(storage));
    const marker = await recovery.markCrash(PROJECT_ID, T1, null);
    expect(marker.ok).toBe(true);
    expect(await recovery.readCrashMarker(PROJECT_ID)).toEqual(
      marker.ok ? { ok: true, value: marker.value } : marker,
    );
    expect(await recovery.clearCrashMarker(PROJECT_ID)).toEqual({ ok: true, value: undefined });
    expect(await recovery.readCrashMarker(PROJECT_ID)).toEqual({ ok: true, value: null });
  });

  it('rejects cross-project/corrupt autosave envelopes', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    const recovery = new RecoveryStore(storage, new AssetStore(storage));
    await recovery.writeAutosave(createProject(), T0);
    const key = Object.keys(storage.dump()).find((item) => item.startsWith('recovery/autosave/'));
    if (!key) throw new Error('fixture failed');
    await storage.commit([{ kind: 'put', key, value: new TextEncoder().encode('{broken') }]);
    const corrupt = await recovery.loadAutosave(PROJECT_ID);
    expect(corrupt.ok).toBe(false);
    const other = await recovery.loadAutosave('مشروع-آخر' as ProjectId);
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.error.code).toBe('AUTOSAVE_NOT_FOUND');
  });
});
