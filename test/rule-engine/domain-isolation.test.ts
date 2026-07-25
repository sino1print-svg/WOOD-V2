import { describe, expect, it } from 'vitest';
import {
  RuleDomain,
  RuleEffectType,
  RulePriorityClass,
  SceneDimension,
  SymbolicTarget,
} from '../../src/shared/domain-model';
import { evaluateRules } from '../../src/engines/rule-engine';
import { input, rule, targetForDomain } from './fixtures';

describe('RuleDomain isolation', () => {
  it('rejects Season targeting garment color', () => {
    const result = evaluateRules(
      input([
        rule({
          priority: RulePriorityClass.Season,
          domain: RuleDomain.GarmentColor,
          effect: {
            type: RuleEffectType.Forbid,
            targets: [{ kind: 'dimension', dimension: SceneDimension.GarmentColor }],
          },
        }),
      ]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe('RULE_CFG_003');
  });

  it('rejects PaletteLock outside palette/garment-color domains', () => {
    const result = evaluateRules(
      input([
        rule({
          priority: RulePriorityClass.PaletteLock,
          domain: RuleDomain.Decor,
          effect: {
            type: RuleEffectType.Lock,
            targets: [{ kind: 'dimension', dimension: SceneDimension.Decor }],
          },
        }),
      ]),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects cover rule mutating scene-generation constraint', () => {
    const result = evaluateRules(
      input([
        rule({
          domain: RuleDomain.Cover,
          effect: {
            type: RuleEffectType.Forbid,
            targets: [{ kind: 'dimension', dimension: SceneDimension.Composition }],
          },
        }),
      ]),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects composition/dedup rule mutating print-area dimension', () => {
    const result = evaluateRules(
      input([
        rule({
          domain: RuleDomain.Composition,
          effect: {
            type: RuleEffectType.Forbid,
            targets: [{ kind: 'dimension', dimension: SceneDimension.PrintAreaRules }],
          },
        }),
      ]),
    );
    expect(result.ok).toBe(false);
  });

  it('allows palette lock to resolve the actual selected colors without introducing others', () => {
    const result = evaluateRules(
      input([
        rule({
          priority: RulePriorityClass.PaletteLock,
          domain: RuleDomain.GarmentColor,
          effect: {
            type: RuleEffectType.Lock,
            targets: [
              { kind: 'contextRef', ref: { ref: 'session.colorSelection.colorIds' as never } },
            ],
          },
        }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.constraints[0]?.lockedTo).toEqual(['black', 'white']);
  });

  it('rejects target/effect mismatch for missing limit and extra limit', () => {
    const missing = evaluateRules(
      input([
        rule({
          effect: {
            type: RuleEffectType.Limit,
            targets: [{ kind: 'symbolic', symbol: SymbolicTarget.Generation }],
          },
        }),
      ]),
    );
    expect(missing.ok).toBe(false);
    const extra = evaluateRules(
      input([
        rule({
          effect: {
            type: RuleEffectType.Forbid,
            targets: [{ kind: 'dimension', dimension: SceneDimension.Composition }],
            limit: { kind: 'literal', value: 1 },
          },
        }),
      ]),
    );
    expect(extra.ok).toBe(false);
  });

  describe('CORRECTIVE #3: authoritative RulePriorityClass -> RuleDomain ownership', () => {
    it('rejects priority=PrintArea with domain=Composition (the concrete example from the corrective spec)', () => {
      const bad = evaluateRules(
        input([
          rule({
            priority: RulePriorityClass.PrintArea,
            domain: RuleDomain.Composition,
            effect: {
              type: RuleEffectType.Forbid,
              targets: [{ kind: 'dimension', dimension: SceneDimension.Composition }],
            },
          }),
        ]),
      );
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.failures[0]?.code).toBe('RULE_CFG_003');
    });

    it.each([
      [RulePriorityClass.PrintArea, RuleDomain.PrintArea],
      [RulePriorityClass.PrintArea, RuleDomain.Background],
      [RulePriorityClass.PrintArea, RuleDomain.Output],
      [RulePriorityClass.AudienceSafety, RuleDomain.Model],
      [RulePriorityClass.AudienceSafety, RuleDomain.Product],
      [RulePriorityClass.AudienceSafety, RuleDomain.Session],
      [RulePriorityClass.AudienceSafety, RuleDomain.Validation],
      [RulePriorityClass.Season, RuleDomain.Decor],
      [RulePriorityClass.Season, RuleDomain.Background],
      [RulePriorityClass.Season, RuleDomain.Validation],
      [RulePriorityClass.PaletteLock, RuleDomain.GarmentColor],
      [RulePriorityClass.PaletteLock, RuleDomain.Palette],
      [RulePriorityClass.SceneAesthetic, RuleDomain.Composition],
      [RulePriorityClass.SceneAesthetic, RuleDomain.Artwork],
      [RulePriorityClass.SceneAesthetic, RuleDomain.Cover],
      [RulePriorityClass.SceneAesthetic, RuleDomain.Output],
      [RulePriorityClass.SceneAesthetic, RuleDomain.Product],
    ])('permits the authoritative pair priority=%s domain=%s', (priority, domain) => {
      const target = targetForDomain(domain)!;
      const good = evaluateRules(
        input([
          rule({ priority, domain, effect: { type: RuleEffectType.Forbid, targets: [target] } }),
        ]),
      );
      expect(good.ok).toBe(true);
    });

    it.each([
      [RulePriorityClass.PrintArea, RuleDomain.Composition],
      [RulePriorityClass.PrintArea, RuleDomain.GarmentColor],
      [RulePriorityClass.Season, RuleDomain.GarmentColor],
      [RulePriorityClass.Season, RuleDomain.Composition],
      [RulePriorityClass.PaletteLock, RuleDomain.Decor],
      [RulePriorityClass.PaletteLock, RuleDomain.Composition],
      [RulePriorityClass.AudienceSafety, RuleDomain.Composition],
      [RulePriorityClass.AudienceSafety, RuleDomain.GarmentColor],
    ])('rejects the invalid pair priority=%s domain=%s', (priority, domain) => {
      const target = targetForDomain(domain)!;
      const bad = evaluateRules(
        input([
          rule({ priority, domain, effect: { type: RuleEffectType.Forbid, targets: [target] } }),
        ]),
      );
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.failures[0]?.code).toBe('RULE_CFG_003');
    });
  });
});
