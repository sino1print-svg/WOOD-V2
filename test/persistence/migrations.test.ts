import { describe, expect, it } from 'vitest';
import {
  migrateProjectDocument,
  migrateRuleSetDocument,
  migrateRuleSetV2ToV3,
  migrateRuleV2PayloadToV3,
} from '../../src/persistence';
import { createProject, T0 } from './fixtures';

const RULE_V2 = {
  id: 'rule-001',
  priority: 1,
  domain: 'session',
  condition: {
    field: 'session.requestedSceneCount',
    operator: 'num_gt',
    value: 0,
  },
  effect: {
    type: 'limit',
    targets: ['generation', 'pose', 'literal-value'],
    limit: 3,
  },
};

const RULE_WITH_CONTEXT_REFS_V2 = {
  ...RULE_V2,
  id: 'rule-002',
  effect: {
    ...RULE_V2.effect,
    targets: [{ ref: 'scene.productId' }],
    limit: { ref: 'session.requestedSceneCount' },
  },
};

const RULE_SET_V2 = {
  id: 'rule-set-001',
  schemaVersion: 2,
  name: 'Legacy rules',
  ruleIds: ['rule-001'],
};

describe('forward-only migration foundation', () => {
  it('accepts current project schema as identity', async () => {
    const result = await migrateProjectDocument(createProject());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.records).toEqual([]);
  });

  it('rejects newer project schemas and undefined older migrations', async () => {
    const newer = await migrateProjectDocument({ ...createProject(), schemaVersion: 2 });
    expect(newer.ok).toBe(false);
    if (!newer.ok) expect(newer.error.code).toBe('UNSUPPORTED_SCHEMA_VERSION');
    const older = await migrateProjectDocument({ ...createProject(), schemaVersion: 0 });
    expect(older.ok).toBe(false);
    if (!older.ok) expect(older.error.code).toBe('MIGRATION_FAILED');
  });

  it('migrates Rule and RuleSet as separate aggregates', () => {
    const ruleBefore = JSON.stringify(RULE_V2);
    const rule = migrateRuleV2PayloadToV3(RULE_V2);
    expect(rule.ok).toBe(true);
    expect(JSON.stringify(RULE_V2)).toBe(ruleBefore);
    if (rule.ok) {
      expect(rule.value.value.effect.targets).toEqual([
        { kind: 'symbolic', symbol: 'generation' },
        { kind: 'dimension', dimension: 'pose' },
        { kind: 'literal', value: 'literal-value' },
      ]);
      expect(rule.value.value.effect.limit).toEqual({ kind: 'literal', value: 3 });
      expect(rule.value.records).toEqual([]);
    }

    const ruleSetBefore = JSON.stringify(RULE_SET_V2);
    const ruleSet = migrateRuleSetV2ToV3(RULE_SET_V2, T0);
    expect(ruleSet.ok).toBe(true);
    expect(JSON.stringify(RULE_SET_V2)).toBe(ruleSetBefore);
    if (ruleSet.ok) {
      expect(ruleSet.value.value).toEqual({ ...RULE_SET_V2, schemaVersion: 3 });
      expect(ruleSet.value.value.ruleIds).toEqual(['rule-001']);
      expect(ruleSet.value.records).toHaveLength(1);
    }
  });

  it('converts ContextRef targets and limits exactly and deterministically', () => {
    const first = migrateRuleV2PayloadToV3(RULE_WITH_CONTEXT_REFS_V2);
    const second = migrateRuleV2PayloadToV3(structuredClone(RULE_WITH_CONTEXT_REFS_V2));
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.value.effect.targets).toEqual([
        { kind: 'contextRef', ref: { ref: 'scene.productId' } },
      ]);
      expect(first.value.value.effect.limit).toEqual({
        kind: 'contextRef',
        ref: { ref: 'session.requestedSceneCount' },
      });
    }
  });

  it('is idempotent for current RuleSet aggregates and rejects future versions', () => {
    const current = { ...RULE_SET_V2, schemaVersion: 3 };
    const first = migrateRuleSetDocument(current, T0);
    const second = migrateRuleSetDocument(current, T0);
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.changed).toBe(false);
      expect(first.value.records).toEqual([]);
    }
    const future = migrateRuleSetDocument({ ...current, schemaVersion: 4 }, T0);
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.error.code).toBe('UNSUPPORTED_SCHEMA_VERSION');
  });

  it('fails closed when RuleDomain reclassification has no authoritative mapping', () => {
    const source = { ...RULE_V2, domain: 'legacy_unknown_domain' };
    const before = JSON.stringify(source);
    const result = migrateRuleV2PayloadToV3(source);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('MIGRATION_SPECIFICATION_BLOCKED');
    expect(JSON.stringify(source)).toBe(before);
  });

  it('preserves migration input when malformed migration fails', () => {
    const source = { schemaVersion: 2, id: 'rule-set-001', ruleIds: 'not-an-array' };
    const before = JSON.stringify(source);
    expect(migrateRuleSetV2ToV3(source, T0).ok).toBe(false);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('rejects malformed legacy Rule payloads and preserves their source object', () => {
    const source = { ...RULE_V2, effect: { type: 'limit', targets: 'not-an-array' } };
    const before = structuredClone(source);
    const result = migrateRuleV2PayloadToV3(source);
    expect(result.ok).toBe(false);
    expect(source).toEqual(before);
  });
});
