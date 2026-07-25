import { describe, expect, it } from 'vitest';
import {
  PERSISTENCE_FAILURE_CATALOG,
  fail,
  type PersistenceFailureCode,
} from '../../src/persistence';

const EXPECTED_CODES: readonly PersistenceFailureCode[] = [
  'PROJECT_NOT_FOUND',
  'PROJECT_ALREADY_EXISTS',
  'OVERWRITE_REQUIRED',
  'CORRUPT_JSON',
  'VALIDATION_FAILED',
  'UNSUPPORTED_SCHEMA_VERSION',
  'MIGRATION_FAILED',
  'MIGRATION_SPECIFICATION_BLOCKED',
  'STORAGE_FAILURE',
  'SNAPSHOT_CORRUPT',
  'SNAPSHOT_NOT_FOUND',
  'RETENTION_POLICY_INVALID',
  'RETENTION_POLICY_UNSUPPORTED',
  'RESTORE_FAILED',
  'AUTOSAVE_NOT_FOUND',
  'RECOVERY_NOT_AVAILABLE',
  'ASSET_NOT_FOUND',
  'ASSET_ALREADY_EXISTS',
  'ASSET_CORRUPT',
  'ASSET_CROSS_PROJECT',
  'ASSET_INVALID_PNG',
  'ASSET_RESOURCE_LIMIT',
  'ASSET_METADATA_INVALID',
];

describe('Phase 1 persistence failure contract', () => {
  it('has a complete locally-namespaced bilingual descriptor for every code', () => {
    expect(Object.keys(PERSISTENCE_FAILURE_CATALOG).sort()).toEqual([...EXPECTED_CODES].sort());
    for (const code of EXPECTED_CODES) {
      const descriptor = PERSISTENCE_FAILURE_CATALOG[code];
      expect(descriptor.messageAr.trim().length).toBeGreaterThan(8);
      expect(descriptor.messageEn.trim().length).toBeGreaterThan(8);
      expect(['warning', 'error', 'blocking']).toContain(descriptor.severity);
      expect(typeof descriptor.retryable).toBe('boolean');
      expect(descriptor.recoveryAction.length).toBeGreaterThan(0);
    }
  });

  it('returns matching Arabic/English semantics, severity and retryability', () => {
    const result = fail('OVERWRITE_REQUIRED', 'write');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('OVERWRITE_REQUIRED');
      expect(result.error.severity).toBe('blocking');
      expect(result.error.retryable).toBe(false);
      expect(result.error.message).toBe(result.error.messageEn);
      expect(result.error.messageAr).toContain('تأكيد');
      expect(result.error.messageEn).toContain('confirmation');
    }
  });

  it('sanitizes absolute paths, bytes, secrets and oversized detail strings', () => {
    const result = fail('STORAGE_FAILURE', 'write', {
      details: {
        fileLocation: '/home/user/private/project.json',
        rawBytes: new Uint8Array([1, 2, 3]),
        apiToken: 'do-not-leak',
        note: 'x'.repeat(600),
        jsonPointer: '/sessions/جلسة-001/scenes/scene-001',
      },
    });
    if (result.ok) throw new Error('fixture failed');
    expect(result.error.details?.fileLocation).toBe('[absolute path redacted]');
    expect(result.error.details?.rawBytes).toBe('[redacted]');
    expect(result.error.details?.apiToken).toBe('[redacted]');
    expect(String(result.error.details?.note).length).toBeLessThan(520);
    expect(result.error.details?.jsonPointer).toBe('/sessions/جلسة-001/scenes/scene-001');
  });

  it('preserves only a safe cause category/name and never leaks an Error message or stack', () => {
    const result = fail('STORAGE_FAILURE', 'write', {
      cause: new Error('/private/path secret payload'),
      details: { operation: 'atomic_commit' },
    });
    if (result.ok) throw new Error('fixture failed');
    expect(result.error.details?.causeName).toBe('Error');
    expect(result.error.details?.operation).toBe('atomic_commit');
    expect(JSON.stringify(result.error)).not.toContain('/private/path');
    expect(JSON.stringify(result.error)).not.toContain('secret payload');
    expect(JSON.stringify(result.error)).not.toContain('stack');
  });
});
