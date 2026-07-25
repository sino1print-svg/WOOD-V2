/**
 * Error registry conformance (deterministic).
 * Verifies namespaced codes (RULE_/PROMPT_/COVER_/EXPORT_) with Arabic + English
 * messages per RE §14, PE §21, CE §19, EX §19.
 */
import { describe, it, expect } from 'vitest';
import { ERROR_REGISTRY, ERROR_BY_CODE } from '../../src/shared/errors';

describe('error registry', () => {
  it('has no duplicate codes', () => {
    const codes = ERROR_REGISTRY.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('every code uses a known namespace matching its prefix', () => {
    for (const e of ERROR_REGISTRY) {
      expect(e.code.startsWith(e.namespace + '_')).toBe(true);
    }
  });

  it('every entry has non-empty Arabic and English messages', () => {
    for (const e of ERROR_REGISTRY) {
      expect(e.messageAr.length).toBeGreaterThan(0);
      expect(e.messageEn.length).toBeGreaterThan(0);
    }
  });

  it('covers all four engine namespaces', () => {
    const namespaces = new Set(ERROR_REGISTRY.map((e) => e.namespace));
    expect(namespaces).toEqual(new Set(['RULE', 'PROMPT', 'COVER', 'EXPORT']));
  });

  it('includes the P0 invariant codes', () => {
    for (const code of [
      'RULE_PA_001',
      'RULE_COV_001',
      'RULE_DUP_001',
      'RULE_CNT_001',
      'PROMPT_SRC_001',
      'PROMPT_PNG_001',
      'PROMPT_COLLAGE_001',
      'COVER_BARRIER_001',
      'COVER_SRC_001',
      'EXPORT_COVER_001',
      'EXPORT_RESTORE_002',
    ]) {
      expect(ERROR_BY_CODE[code]).toBeDefined();
    }
  });

  it('ERROR_BY_CODE is complete and consistent with ERROR_REGISTRY', () => {
    expect(Object.keys(ERROR_BY_CODE).length).toBe(ERROR_REGISTRY.length);
    for (const e of ERROR_REGISTRY) {
      expect(ERROR_BY_CODE[e.code]).toBe(e);
    }
  });
});
