/**
 * Phase 10.5 — artwork registration command tests. The real Asset Store PNG
 * validation pipeline must accept a genuine PNG and reject invalid bytes with
 * a typed, user-facing failure.
 */
import { describe, expect, it } from 'vitest';
import { registerArtworkPng } from '../../src/app/commands';
import { APP_PROJECT_ID, CANONICAL_APP_TIME } from '../../src/app/catalog';
import { tinyPngBytes } from './fixtures';

describe('Phase 10.5 artwork registration', () => {
  it('registers a real PNG and returns a complete Artwork record', async () => {
    const result = await registerArtworkPng(tinyPngBytes(), 'design.png');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artwork.projectId).toBe(APP_PROJECT_ID);
    expect(result.artwork.format).toBe('png');
    expect(result.artwork.widthPx).toBe(1);
    expect(result.artwork.heightPx).toBe(1);
    expect(result.artwork.uploadedAt).toBe(CANONICAL_APP_TIME);
    expect(result.artwork.contentHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('is deterministic for identical bytes', async () => {
    const first = await registerArtworkPng(tinyPngBytes(), 'design.png');
    const second = await registerArtworkPng(tinyPngBytes(), 'design.png');
    expect(first).toEqual(second);
  });

  it('rejects non-PNG bytes with a typed failure', async () => {
    const result = await registerArtworkPng(new Uint8Array([1, 2, 3, 4]), 'design.png');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe('ASSET_INVALID_PNG');
    expect(result.failure.messageAr.length).toBeGreaterThan(0);
  });

  it('rejects an invalid file name with a typed failure', async () => {
    const result = await registerArtworkPng(tinyPngBytes(), '../escape.png');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe('ASSET_METADATA_INVALID');
  });
});
