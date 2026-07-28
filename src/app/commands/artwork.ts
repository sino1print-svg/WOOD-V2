/**
 * Artwork registration command — Phase 10.5.
 *
 * Registers a user-uploaded PNG through the real Asset Store (full PNG
 * structural validation, resource limits, and content hashing) and returns
 * the resulting domain `Artwork` record required by Output B composition.
 * Deterministic: the canonical application time is used as the registration
 * timestamp so identical bytes always produce identical records.
 */
import type { Artwork, ArtworkId, ProjectId } from '../../shared/domain-model';
import { AssetStore, InMemoryDeterministicStorageAdapter } from '../../persistence';
import { APP_PROJECT_ID, CANONICAL_APP_TIME } from '../catalog';

export interface ArtworkRegistrationFailure {
  readonly code: string;
  readonly messageAr: string;
}

export type ArtworkRegistrationResult =
  | { readonly ok: true; readonly artwork: Artwork }
  | { readonly ok: false; readonly failure: ArtworkRegistrationFailure };

/**
 * Validates and registers the uploaded PNG bytes as the session artwork.
 * A fresh in-memory store is used per registration: the artwork record lives
 * in application state for the session (persistence of binary assets is
 * outside the Phase 10.5 scope).
 */
export async function registerArtworkPng(
  bytes: Uint8Array,
  fileName: string,
): Promise<ArtworkRegistrationResult> {
  const store = new AssetStore(new InMemoryDeterministicStorageAdapter());
  try {
    const result = await store.registerPng({
      projectId: APP_PROJECT_ID as ProjectId,
      artworkId: 'artwork-session-upload' as ArtworkId,
      fileName,
      bytes,
      uploadedAt: CANONICAL_APP_TIME,
    });
    if (!result.ok) {
      return {
        ok: false,
        failure: {
          code: result.error.code,
          messageAr: result.error.messageAr ?? 'تعذر التحقق من ملف PNG.',
        },
      };
    }
    return { ok: true, artwork: result.value.artwork };
  } catch {
    return {
      ok: false,
      failure: { code: 'ASSET_REGISTER_FAILED', messageAr: 'تعذر تسجيل ملف PNG بأمان.' },
    };
  }
}
