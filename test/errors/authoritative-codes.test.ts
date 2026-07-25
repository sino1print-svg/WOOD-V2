/**
 * Error registry vs authoritative code lists (deterministic).
 * The expected lists are transcribed directly from the specification error
 * registries: RE §14, PE §21, CE §19, EX §19. The test asserts the runtime
 * registry set equals the authoritative set exactly (no missing, no invented).
 */
import { describe, it, expect } from 'vitest';
import { ERROR_REGISTRY } from '../../src/shared/errors';

const RULE_CODES = [
  'RULE_PA_001',
  'RULE_PA_002',
  'RULE_PA_003',
  'RULE_PA_004',
  'RULE_PA_005',
  'RULE_PA_005N',
  'RULE_PA_006',
  'RULE_PA_007',
  'RULE_TXT_001',
  'RULE_CLG_001',
  'RULE_CLG_002',
  'RULE_AUD_001',
  'RULE_AUD_002',
  'RULE_AUD_003',
  'RULE_AUD_004',
  'RULE_PRD_001',
  'RULE_PRD_002',
  'RULE_PRD_003',
  'RULE_PRD_004',
  'RULE_SEA_001',
  'RULE_SEA_002',
  'RULE_SEA_003',
  'RULE_SEA_004',
  'RULE_SEA_005',
  'RULE_PAL_001',
  'RULE_PAL_002',
  'RULE_PAL_003',
  'RULE_DUP_001',
  'RULE_CNT_001',
  'RULE_CNT_002',
  'RULE_PRV_001',
  'RULE_PRV_002',
  'RULE_PRV_003',
  'RULE_COV_001',
  'RULE_COV_002',
  'RULE_COV_003',
  'RULE_ART_001',
  'RULE_ART_002',
  'RULE_ART_003',
  'RULE_CFG_001',
  'RULE_CFG_002',
  'RULE_CFG_003',
];

const PROMPT_CODES = [
  'PROMPT_SRC_001',
  'PROMPT_PNG_001',
  'PROMPT_STALE_001',
  'PROMPT_PRD_001',
  'PROMPT_VIEW_001',
  'PROMPT_COLOR_001',
  'PROMPT_COLLAGE_001',
  'PROMPT_ART_001',
  'PROMPT_COV_001',
  'PROMPT_VAR_001',
  'PROMPT_MOD_001',
  'PROMPT_AUD_001',
  'PROMPT_TXT_001',
];

const COVER_CODES = [
  'COVER_BARRIER_001',
  'COVER_SRC_001',
  'COVER_LOCK_001',
  'COVER_DUP_001',
  'COVER_COUNT_001',
  'COVER_COLOR_001',
  'COVER_META_001',
  'COVER_LAYOUT_001',
  'COVER_GREENBG_001',
  'COVER_VAR_001',
];

const EXPORT_CODES = [
  'EXPORT_CLIP_001',
  'EXPORT_CLIP_002',
  'EXPORT_FILE_001',
  'EXPORT_ZIP_001',
  'EXPORT_SCOPE_001',
  'EXPORT_SCOPE_002',
  'EXPORT_MISSINGA_001',
  'EXPORT_LINK_001',
  'EXPORT_PNG_001',
  'EXPORT_STALE_001',
  'EXPORT_COVER_001',
  'EXPORT_COVERCOUNT_001',
  'EXPORT_FILENAME_001',
  'EXPORT_PATH_001',
  'EXPORT_CHECKSUM_001',
  'EXPORT_CORRUPT_001',
  'EXPORT_SCHEMA_001',
  'EXPORT_RESTORE_001',
  'EXPORT_RESTORE_002',
  'EXPORT_STORAGE_001',
  'EXPORT_CANCELLED_001',
  'EXPORT_PROMPTVAR_001',
  'EXPORT_NUM_001',
  'EXPORT_GROUP_001',
];

const AUTHORITATIVE = [...RULE_CODES, ...PROMPT_CODES, ...COVER_CODES, ...EXPORT_CODES];

describe('authoritative error codes', () => {
  const registryCodes = new Set(ERROR_REGISTRY.map((e) => e.code));

  it('every authoritative code is present', () => {
    const missing = AUTHORITATIVE.filter((c) => !registryCodes.has(c));
    expect(missing).toEqual([]);
  });

  it('registry invents no undocumented codes', () => {
    const authoritative = new Set(AUTHORITATIVE);
    const extra = [...registryCodes].filter((c) => !authoritative.has(c));
    expect(extra).toEqual([]);
  });

  it('authoritative list itself has no duplicates', () => {
    expect(new Set(AUTHORITATIVE).size).toBe(AUTHORITATIVE.length);
  });

  it('counts match (registry === authoritative)', () => {
    expect(ERROR_REGISTRY.length).toBe(AUTHORITATIVE.length);
    expect(AUTHORITATIVE.length).toBe(89);
  });

  it('every entry has correct namespace prefix + AR/EN text', () => {
    for (const e of ERROR_REGISTRY) {
      expect(e.code.startsWith(e.namespace + '_')).toBe(true);
      expect(e.messageAr.trim().length).toBeGreaterThan(0);
      expect(e.messageEn.trim().length).toBeGreaterThan(0);
    }
  });
});
