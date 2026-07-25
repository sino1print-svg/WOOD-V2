import { describe, expect, it } from 'vitest';
import type { ArtworkId, AssetRef, Project, ProjectId } from '../../src/shared/domain-model';
import {
  AssetStore,
  InMemoryDeterministicStorageAdapter,
  ProjectStore,
  RecentProjectsStore,
  assetDataStorageKey,
  canonicalStringify,
  decodeUtf8,
  encodeUtf8,
  legacyProjectStorageKey,
  projectStorageKey,
  recentMetadataFromProject,
  serializeProject,
} from '../../src/persistence';
import { createNestedProject, createProject, PROJECT_ID, T0, T1, T2 } from './fixtures';
import { makeSmallPng } from './png-fixtures';

const ARTWORK_ID = 'artwork-001' as ArtworkId;

function attachArtwork(project: Project, artwork: Project['artworks'][ArtworkId]): Project {
  return { ...project, artworks: { ...project.artworks, [artwork.id]: artwork } };
}

function legacyNestedProject(): Record<string, unknown> {
  const project = structuredClone(createNestedProject()) as unknown as Record<string, unknown>;
  const session = (project.sessions as Record<string, Record<string, unknown>>)['جلسة-001'];
  const scene = (session.scenes as Record<string, Record<string, unknown>>)['scene-001'];
  const outputA = scene.outputA as Record<string, unknown>;
  delete scene.sceneVersion;
  delete scene.sceneHash;
  delete scene.sceneFingerprint;
  delete outputA.promptHash;
  delete outputA.renderHash;
  delete outputA.promptMeta;
  delete session.fingerprint;
  return project;
}

describe('Phase 1 public API integration', () => {
  it('A. saves a new project with mandatory snapshot, recent metadata, load and canonical roundtrip', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    const projects = new ProjectStore(storage);
    const recent = new RecentProjectsStore(storage);
    const first = await projects.save(createNestedProject(), { overwrite: false, timestamp: T0 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.versionOrder).toHaveLength(1);
    expect(first.value.currentVersionId).toBe(first.value.versionOrder[0]);
    await recent.record(recentMetadataFromProject(first.value, T0));
    const listed = await recent.list();
    expect(listed.ok && listed.value[0]?.projectId).toBe(PROJECT_ID);
    const loaded = await projects.load(PROJECT_ID);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(serializeProject(loaded.value.project)).toEqual(serializeProject(first.value));
    const stored = storage.dump()[await projectStorageKey(PROJECT_ID)];
    const decoded = decodeUtf8(stored);
    const serialized = serializeProject(first.value);
    expect(decoded.ok && serialized.ok && decoded.value === serialized.value).toBe(true);
  });

  it('B. register PNG → attach Artwork → save/load → retrieve and verify bytes/hash/metadata', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    const assets = new AssetStore(storage);
    const projects = new ProjectStore(storage, assets);
    const png = makeSmallPng({ width: 2, height: 3, dpi: 300 });
    const registered = await assets.registerPng({
      projectId: PROJECT_ID,
      artworkId: ARTWORK_ID,
      fileName: 'فن.png',
      bytes: png,
      uploadedAt: T0,
    });
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    const project = attachArtwork(createProject(), registered.value.artwork);
    const saved = await projects.save(project, { overwrite: false, timestamp: T0 });
    expect(saved.ok).toBe(true);
    const loaded = await projects.load(PROJECT_ID);
    expect(loaded.ok).toBe(true);
    const retrieved = await assets.retrieve(PROJECT_ID, registered.value.artwork.pngAssetRef);
    expect(retrieved.ok).toBe(true);
    if (loaded.ok && retrieved.ok) {
      expect(loaded.value.project.artworks[ARTWORK_ID]).toEqual(registered.value.artwork);
      expect(retrieved.value.record.artwork.contentHash).toBe(registered.value.artwork.contentHash);
      expect(retrieved.value.record.artwork.widthPx).toBe(2);
      expect(retrieved.value.record.artwork.heightPx).toBe(3);
      expect(retrieved.value.record.artwork.dpi).toBe(300);
      expect(retrieved.value.bytes).toEqual(png);
    }
  });

  it('C. rejects unconfirmed overwrite, preserves bytes, then appends a snapshot on confirmed overwrite', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    const projects = new ProjectStore(storage);
    const first = await projects.save(createProject(), { overwrite: false, timestamp: T0 });
    if (!first.ok) throw new Error('fixture failed');
    const key = await projectStorageKey(PROJECT_ID);
    const before = storage.dump()[key];
    const changed = { ...first.value, name: 'Changed', updatedAt: T1 };
    const refused = await projects.save(changed, { overwrite: false, timestamp: T1 });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe('OVERWRITE_REQUIRED');
    expect(storage.dump()[key]).toEqual(before);
    const confirmed = await projects.save(changed, { overwrite: true, timestamp: T1 });
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) {
      expect(confirmed.value.versionOrder).toHaveLength(2);
      const [firstId, secondId] = confirmed.value.versionOrder;
      expect(confirmed.value.currentVersionId).toBe(secondId);
      expect(confirmed.value.versionHistory[secondId].parentVersionId).toBe(firstId);
    }
  });

  it('D. rejects corrupt project bytes and explicitly recovers the latest valid independent snapshot', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    const projects = new ProjectStore(storage);
    const first = await projects.save(createProject(), { overwrite: false, timestamp: T0 });
    if (!first.ok) throw new Error('fixture failed');
    const second = await projects.save(
      { ...first.value, name: 'Second', updatedAt: T1 },
      { overwrite: true, timestamp: T1 },
    );
    if (!second.ok) throw new Error('fixture failed');
    const key = await projectStorageKey(PROJECT_ID);
    await storage.commit([{ kind: 'put', key, value: encodeUtf8('{corrupt') }]);
    const load = await projects.load(PROJECT_ID);
    expect(load.ok).toBe(false);
    const recovered = await projects.recoverLatestValidSnapshot(PROJECT_ID);
    expect(recovered.ok).toBe(true);
    if (recovered.ok) {
      expect(recovered.value.recovered).toBe(true);
      expect(recovered.value.project.currentVersionId).toBe(second.value.currentVersionId);
      expect(recovered.value.project.versionOrder).toEqual(second.value.versionOrder);
    }
  });

  it('E. injected failure during project+snapshot batch leaves no partial project or orphan snapshot', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    storage.setFaultPlan({ failCommitNumber: 1, failAfterOperation: 1 });
    const saved = await new ProjectStore(storage).save(createProject(), {
      overwrite: false,
      timestamp: T0,
    });
    expect(saved.ok).toBe(false);
    expect(storage.dump()).toEqual({});
  });

  it('E2. failed overwrite preserves previous project bytes, currentVersionId and snapshot journal', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    const projects = new ProjectStore(storage);
    const first = await projects.save(createProject(), { overwrite: false, timestamp: T0 });
    if (!first.ok) throw new Error('fixture failed');
    const before = storage.dump();
    storage.setFaultPlan({ failCommitNumber: 2, failAfterOperation: 2 });
    const failed = await projects.save(
      { ...first.value, name: 'Should not persist', updatedAt: T1 },
      { overwrite: true, timestamp: T1 },
    );
    expect(failed.ok).toBe(false);
    expect(storage.dump()).toEqual(before);
    const loaded = await projects.load(PROJECT_ID);
    expect(loaded.ok && loaded.value.project.currentVersionId).toBe(first.value.currentVersionId);
  });

  it('F. migrates supported current-version backfills deterministically and writes back atomically', async () => {
    const legacy = legacyNestedProject();
    const legacyKey = legacyProjectStorageKey(PROJECT_ID);
    if (!legacyKey) throw new Error('fixture failed');
    const sourceBytes = encodeUtf8(JSON.stringify(legacy));
    const storage = new InMemoryDeterministicStorageAdapter({ [legacyKey]: sourceBytes });
    const projects = new ProjectStore(storage);
    const loaded = await projects.load(PROJECT_ID);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value.migrated).toBe(true);
      const repeat = await projects.load(PROJECT_ID);
      expect(repeat.ok).toBe(true);
      if (repeat.ok) expect(repeat.value.project).toEqual(loaded.value.project);
    }
    expect(storage.dump()[legacyKey]).toBeUndefined();
    expect(storage.dump()[await projectStorageKey(PROJECT_ID)]).toBeDefined();
  });

  it('F2. migration write-back failure preserves the original serialized bytes', async () => {
    const legacyKey = legacyProjectStorageKey(PROJECT_ID);
    if (!legacyKey) throw new Error('fixture failed');
    const sourceBytes = encodeUtf8(JSON.stringify(legacyNestedProject()));
    const storage = new InMemoryDeterministicStorageAdapter({ [legacyKey]: sourceBytes });
    storage.setFaultPlan({ failCommitNumber: 1, failAfterOperation: 1 });
    const loaded = await new ProjectStore(storage).load(PROJECT_ID);
    expect(loaded.ok).toBe(false);
    expect(storage.dump()[legacyKey]).toEqual(sourceBytes);
    expect(storage.dump()[await projectStorageKey(PROJECT_ID)]).toBeUndefined();
  });

  it('G. Project B cannot claim or retrieve Project A asset association', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    const assets = new AssetStore(storage);
    const registered = await assets.registerPng({
      projectId: PROJECT_ID,
      artworkId: ARTWORK_ID,
      fileName: 'artwork.png',
      bytes: makeSmallPng(),
      uploadedAt: T0,
    });
    if (!registered.ok) throw new Error('fixture failed');
    const otherId = 'project-B' as ProjectId;
    const claimed = {
      ...registered.value.artwork,
      projectId: otherId,
    };
    const save = await new ProjectStore(storage, assets).save(
      attachArtwork(createProject({ id: otherId }), claimed),
      { overwrite: false, timestamp: T0 },
    );
    expect(save.ok).toBe(false);
    const read = await assets.retrieve(otherId, registered.value.artwork.pngAssetRef);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error.code).toBe('ASSET_CROSS_PROJECT');
  });

  it('rejects unknown AssetRef, missing asset and corrupt stored bytes during storage-aware validation', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    const assets = new AssetStore(storage);
    const unknownArtwork = {
      id: ARTWORK_ID,
      projectId: PROJECT_ID,
      fileName: 'unknown.png',
      pngAssetRef: 'unknown-opaque-ref' as AssetRef,
      uploadedAt: T0,
      format: 'png' as const,
      hasTransparency: true,
      widthPx: 1,
      heightPx: 1,
      aspectRatio: 1,
      contentHash: 'unknown-hash' as never,
    };
    const missing = await new ProjectStore(storage, assets).save(
      attachArtwork(createProject(), unknownArtwork),
      { overwrite: false, timestamp: T0 },
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('ASSET_NOT_FOUND');

    const registered = await assets.registerPng({
      projectId: PROJECT_ID,
      artworkId: ARTWORK_ID,
      fileName: 'corrupt.png',
      bytes: makeSmallPng(),
      uploadedAt: T0,
    });
    if (!registered.ok) throw new Error('fixture failed');
    const key = await assetDataStorageKey(registered.value.artwork.pngAssetRef);
    const tampered = storage.dump()[key].slice();
    tampered[tampered.length - 1] ^= 1;
    await storage.commit([{ kind: 'put', key, value: tampered }]);
    const corrupt = await new ProjectStore(storage, assets).save(
      attachArtwork(createProject(), registered.value.artwork),
      { overwrite: false, timestamp: T0 },
    );
    expect(corrupt.ok).toBe(false);
    if (!corrupt.ok) expect(corrupt.error.code).toBe('ASSET_CORRUPT');
  });

  it('H. Arabic and mixed-language domain IDs roundtrip while storage keys stay opaque', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    const id = 'مشروع Mixed ١' as ProjectId;
    const projects = new ProjectStore(storage);
    const saved = await projects.save(createProject({ id, name: 'مشروع تجريبي' }), {
      overwrite: false,
      timestamp: T2,
    });
    expect(saved.ok).toBe(true);
    const loaded = await projects.load(id);
    expect(loaded.ok && loaded.value.project.id).toBe(id);
    expect(Object.keys(storage.dump()).every((key) => !key.includes('مشروع'))).toBe(true);
  });

  it('canonical serialization remains deterministic for equivalent insertion orders', () => {
    const left = canonicalStringify({ b: 2, a: { y: 2, x: 1 } });
    const right = canonicalStringify({ a: { x: 1, y: 2 }, b: 2 });
    expect(left).toEqual(right);
  });
});
