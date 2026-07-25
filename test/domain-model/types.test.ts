/**
 * Domain-model conformance checks (deterministic).
 * Verifies enum values transcribed from 03_DATA_MODELS_FINAL are exact and that
 * key invariants hold at the value level. Type-level conformance is enforced by
 * `tsc --noEmit`; this file guards the runtime enum values.
 */
import { describe, it, expect } from 'vitest';
import {
  Audience,
  CoverLayout,
  DisplayMethod,
  GarmentView,
  ProductKind,
  RuleDomain,
  RuleOperator,
  RulePriorityClass,
  SeasonKind,
  SessionStatus,
  ValidationSeverity,
} from '../../src/shared/domain-model';

describe('domain-model enums', () => {
  it('ProductKind lists the 11 PRD §6 products', () => {
    expect(Object.values(ProductKind).sort()).toEqual(
      [
        'bella_canvas_3001',
        'classic_tshirt',
        'comfort_colors',
        'oversized',
        'hoodie',
        'crewneck',
        'kids',
        'tank',
        'polo',
        'raglan',
        'zip_hoodie',
      ].sort(),
    );
  });

  it('SeasonKind lists the 11 PRD §7 seasons', () => {
    expect(Object.values(SeasonKind)).toHaveLength(11);
    expect(Object.values(SeasonKind)).toContain('minimal_studio');
  });

  it('Audience is the [R1] taxonomy', () => {
    expect(Object.values(Audience)).toEqual(['kids', 'adult', 'unisex', 'teen', 'all']);
  });

  it('RulePriorityClass keeps Print Area highest (=1)', () => {
    expect(RulePriorityClass.PrintArea).toBe(1);
    expect(RulePriorityClass.SceneAesthetic).toBe(5);
  });

  it('RuleOperator includes numeric and presence operators (RE §12)', () => {
    const ops = Object.values(RuleOperator);
    for (const required of [
      'num_eq',
      'num_gte',
      'num_lte',
      'num_gt',
      'num_lt',
      'exists',
      'is_null',
      'excludes',
    ]) {
      expect(ops).toContain(required);
    }
  });

  it('RuleDomain contains the expanded 16 domains including garment_color', () => {
    expect(Object.values(RuleDomain)).toHaveLength(16);
    expect(Object.values(RuleDomain)).toContain('garment_color');
    expect(Object.values(RuleDomain)).toContain('palette');
  });

  it('CoverLayout enumerates the [R3] layout families', () => {
    expect(Object.values(CoverLayout)).toEqual([
      'single',
      'duo',
      'triptych',
      'grid_2x2',
      'grid_2x3',
      'grid_3x3',
      'mosaic',
    ]);
  });

  it('DisplayMethod / GarmentView / SessionStatus / ValidationSeverity are stable', () => {
    expect(Object.values(DisplayMethod)).toContain('flat_lay');
    expect(Object.values(GarmentView)).toEqual(['front', 'back', 'side', 'flat_detail']);
    expect(Object.values(SessionStatus)).toContain('cover_build');
    expect(Object.values(ValidationSeverity)).toEqual(['blocking', 'warning']);
  });
});
