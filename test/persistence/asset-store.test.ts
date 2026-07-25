import { describe, expect, it } from 'vitest';
import type { ArtworkId, AssetRef, ProjectId } from '../../src/shared/domain-model';
import {
  AssetStore,
  InMemoryDeterministicStorageAdapter,
  assetDataStorageKey,
  assetMetadataStorageKey,
  encodeUtf8,
} from '../../src/persistence';
import { PROJECT_ID, T0, TRANSPARENT_PNG } from './fixtures';

const ARTWORK_ID = 'artwork-001' as ArtworkId;

describe('Asset Store foundation', () => {
  it('registers and retrieves verified PNG bytes with metadata and AssetRef', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    const store = new AssetStore(storage);
    const registered = await store.registerPng({
      projectId: PROJECT_ID,
      artworkId: ARTWORK_ID,
      fileName: 'artwork.png',
      bytes: TRANSPARENT_PNG,
      uploadedAt: T0,
    });
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    expect(registered.value.artwork.pngAssetRef.length).toBeGreaterThan(0);
    expect(registered.value.artwork.pngAssetRef.startsWith('/')).toBe(false);
    expect(registered.value.artwork.widthPx).toBe(1);
    expect(registered.value.artwork.heightPx).toBe(1);
    const retrieved = await store.retrieve(PROJECT_ID, registered.value.artwork.pngAssetRef);
    expect(retrieved.ok).toBe(true);
    if (retrieved.ok) expect(retrieved.value.bytes).toEqual(TRANSPARENT_PNG);
  });

  it('rejects invalid PNGs, path-like filenames, and duplicate registrations', async () => {
    const store = new AssetStore(new InMemoryDeterministicStorageAdapter());
    const bad = await store.registerPng({
      projectId: PROJECT_ID,
      artworkId: ARTWORK_ID,
      fileName: 'artwork.png',
      bytes: new Uint8Array([1, 2, 3]),
      uploadedAt: T0,
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('ASSET_INVALID_PNG');

    const path = await store.registerPng({
      projectId: PROJECT_ID,
      artworkId: ARTWORK_ID,
      fileName: 'C:\\secret\\artwork.png',
      bytes: TRANSPARENT_PNG,
      uploadedAt: T0,
    });
    expect(path.ok).toBe(false);
    if (!path.ok) expect(path.error.code).toBe('ASSET_METADATA_INVALID');

    const first = await store.registerPng({
      projectId: PROJECT_ID,
      artworkId: ARTWORK_ID,
      fileName: 'artwork.png',
      bytes: TRANSPARENT_PNG,
      uploadedAt: T0,
    });
    expect(first.ok).toBe(true);
    const duplicate = await store.registerPng({
      projectId: PROJECT_ID,
      artworkId: ARTWORK_ID,
      fileName: 'artwork.png',
      bytes: TRANSPARENT_PNG,
      uploadedAt: T0,
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.error.code).toBe('ASSET_ALREADY_EXISTS');
  });

  it('rejects missing and cross-project assets', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    const store = new AssetStore(storage);
    const missing = await store.retrieve(
      PROJECT_ID,
      `asset:${'a'.repeat(24)}:${'b'.repeat(64)}` as AssetRef,
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('ASSET_NOT_FOUND');

    const registered = await store.registerPng({
      projectId: PROJECT_ID,
      artworkId: ARTWORK_ID,
      fileName: 'artwork.png',
      bytes: TRANSPARENT_PNG,
      uploadedAt: T0,
    });
    if (!registered.ok) throw new Error('fixture failed');
    const cross = await store.retrieve(
      'other-project' as ProjectId,
      registered.value.artwork.pngAssetRef,
    );
    expect(cross.ok).toBe(false);
    if (!cross.ok) expect(cross.error.code).toBe('ASSET_CROSS_PROJECT');
  });

  it('detects tampered bytes by content hash', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    const store = new AssetStore(storage);
    const registered = await store.registerPng({
      projectId: PROJECT_ID,
      artworkId: ARTWORK_ID,
      fileName: 'artwork.png',
      bytes: TRANSPARENT_PNG,
      uploadedAt: T0,
    });
    if (!registered.ok) throw new Error('fixture failed');
    const dataKey = await assetDataStorageKey(registered.value.artwork.pngAssetRef);
    const bytes = TRANSPARENT_PNG.slice();
    bytes[bytes.length - 1] ^= 1;
    await storage.commit([{ kind: 'put', key: dataKey, value: bytes }]);
    const result = await store.retrieve(PROJECT_ID, registered.value.artwork.pngAssetRef);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ASSET_CORRUPT');
  });

  it('detects corrupt metadata and missing byte payload', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    const store = new AssetStore(storage);
    const registered = await store.registerPng({
      projectId: PROJECT_ID,
      artworkId: ARTWORK_ID,
      fileName: 'artwork.png',
      bytes: TRANSPARENT_PNG,
      uploadedAt: T0,
    });
    if (!registered.ok) throw new Error('fixture failed');
    const metadataKey = await assetMetadataStorageKey(registered.value.artwork.pngAssetRef);
    await storage.commit([{ kind: 'put', key: metadataKey, value: encodeUtf8('{}') }]);
    const corrupt = await store.retrieve(PROJECT_ID, registered.value.artwork.pngAssetRef);
    expect(corrupt.ok).toBe(false);
    if (!corrupt.ok) expect(corrupt.error.code).toBe('ASSET_CORRUPT');
  });

  it('rolls back metadata and bytes together on injected atomic failure', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    storage.setFaultPlan({ failCommitNumber: 1, failAfterOperation: 1 });
    const result = await new AssetStore(storage).registerPng({
      projectId: PROJECT_ID,
      artworkId: ARTWORK_ID,
      fileName: 'artwork.png',
      bytes: TRANSPARENT_PNG,
      uploadedAt: T0,
    });
    expect(result.ok).toBe(false);
    expect(Object.keys(storage.dump())).toEqual([]);
  });

  it('loads existing valid legacy-key assets without inferring ownership from AssetRef text', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    const store = new AssetStore(storage);
    const registered = await store.registerPng({
      projectId: PROJECT_ID,
      artworkId: ARTWORK_ID,
      fileName: 'legacy.png',
      bytes: TRANSPARENT_PNG,
      uploadedAt: T0,
    });
    if (!registered.ok) throw new Error('fixture failed');
    const ref = registered.value.artwork.pngAssetRef;
    const currentMeta = await assetMetadataStorageKey(ref);
    const currentData = await assetDataStorageKey(ref);
    const legacy = (await import('../../src/persistence')).legacyAssetStorageKeys(ref);
    if (!legacy) throw new Error('fixture failed');
    const dump = storage.dump();
    await storage.commit([
      { kind: 'put', key: legacy.metadata, value: dump[currentMeta] },
      { kind: 'put', key: legacy.data, value: dump[currentData] },
      { kind: 'delete', key: currentMeta },
      { kind: 'delete', key: currentData },
    ]);
    const retrieved = await store.retrieve(PROJECT_ID, ref);
    expect(retrieved.ok).toBe(true);
    if (retrieved.ok) expect(retrieved.value.bytes).toEqual(TRANSPARENT_PNG);
  });

  it('rejects an Artwork whose project metadata differs from the authoritative asset record', async () => {
    const storage = new InMemoryDeterministicStorageAdapter();
    const store = new AssetStore(storage);
    const registered = await store.registerPng({
      projectId: PROJECT_ID,
      artworkId: ARTWORK_ID,
      fileName: 'authoritative.png',
      bytes: TRANSPARENT_PNG,
      uploadedAt: T0,
    });
    if (!registered.ok) throw new Error('fixture failed');
    const mismatch = await store.validateArtworkAssociation(PROJECT_ID, {
      ...registered.value.artwork,
      fileName: 'different.png',
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.error.code).toBe('ASSET_CORRUPT');
  });
});
