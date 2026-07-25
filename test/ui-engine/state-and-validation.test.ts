import { describe, expect, it } from 'vitest';
import { Audience, DisplayMethod, GarmentView } from '../../src/shared/domain-model';
import {
  createInitialUiState,
  deterministicFingerprint,
  isOutputStale,
  resetForm,
  updateDraft,
  validateDraft,
} from '../../src/ui-engine';
import { catalog, colorId, productId, seasonId, validDraft } from './fixtures';

describe('Phase 6 UI state and validation', () => {
  it('uses an explicit deterministic state union', () => {
    const state = createInitialUiState();
    expect(state.phase).toBe('idle');
    expect(state.step).toBe('session');
    expect(state.activeRequestSequence).toBeNull();
  });

  it('marks generation-affecting edits dirty without generating', () => {
    const state = createInitialUiState(validDraft());
    const edited = updateDraft(
      { ...state, generatedFingerprint: deterministicFingerprint(state.draft), prompts: [] },
      { targetCount: 2 },
    );
    expect(edited.phase).toBe('editing');
    expect(edited.dirty).toBe(true);
    expect(edited.prompts).toEqual([]);
    expect(isOutputStale(edited)).toBe(true);
  });

  it('does not mutate the original state or draft', () => {
    const state = Object.freeze(createInitialUiState(Object.freeze(validDraft())));
    const updated = updateDraft(state, { title: 'عنوان جديد' });
    expect(state.draft.title).toBe('جلسة اختبار');
    expect(updated.draft.title).toBe('عنوان جديد');
  });

  it('resets to canonical defaults', () => {
    const reset = resetForm(createInitialUiState(validDraft()));
    expect(reset.draft.title).toBe('');
    expect(reset.phase).toBe('idle');
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 51])(
    'rejects malformed count %s',
    (targetCount) => {
      expect(
        validateDraft({ ...validDraft(), targetCount }, catalog).some(
          (item) => item.code === 'UI_COUNT_INVALID',
        ),
      ).toBe(true);
    },
  );

  it('rejects a fixed-total mismatch', () => {
    const failures = validateDraft({ ...validDraft(), targetCount: 2 }, catalog);
    expect(failures.map((item) => item.code)).toContain('UI_FIXED_TOTAL_MISMATCH');
  });

  it('rejects duplicate product IDs', () => {
    const draft = validDraft();
    const failures = validateDraft(
      { ...draft, targetCount: 2, products: [...draft.products, { ...draft.products[0] }] },
      catalog,
    );
    expect(failures.map((item) => item.code)).toContain('UI_PRODUCT_DUPLICATE');
  });

  it('rejects unsupported view, display method, audience, and color', () => {
    const failures = validateDraft(
      {
        ...validDraft(),
        audience: Audience.Kids,
        colorIds: ['color-invalid' as typeof colorId],
        products: [
          {
            productId,
            quantity: 1,
            selectedViews: [GarmentView.Side],
            displayMethods: [DisplayMethod.Folded],
          },
        ],
      },
      catalog,
    );
    expect(failures.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'UI_AUDIENCE_INCOMPATIBLE',
        'UI_VIEW_INCOMPATIBLE',
        'UI_DISPLAY_INCOMPATIBLE',
        'UI_COLOR_INCOMPATIBLE',
      ]),
    );
  });

  it('rejects control and bidi characters', () => {
    const failures = validateDraft(
      { ...validDraft(), customSceneDescription: 'safe\u202eunsafe' },
      catalog,
    );
    expect(failures.map((item) => item.code)).toContain('UI_TEXT_CONTROL_INVALID');
  });

  it('accepts the complete valid draft', () => {
    expect(validateDraft(validDraft(), catalog)).toEqual([]);
  });

  it('fingerprints reordered object keys identically', () => {
    const a = validDraft();
    const b = {
      includeOutputB: a.includeOutputB,
      groupBy: a.groupBy,
      customSceneDescription: a.customSceneDescription,
      placement: a.placement,
      colorIds: a.colorIds,
      products: a.products,
      targetCount: a.targetCount,
      countMode: a.countMode,
      audience: a.audience,
      seasonId: seasonId,
      mode: a.mode,
      title: a.title,
    };
    expect(deterministicFingerprint(a)).toBe(deterministicFingerprint(b));
  });
});
