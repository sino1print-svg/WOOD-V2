/**
 * Phase 10.5 — Application Orchestrator integration tests.
 * The real engine ports must generate real, deterministic Output A/B prompts
 * from a UI draft with no mocks in the production path.
 */
import { describe, expect, it } from 'vitest';
import { Audience, DisplayMethod, GarmentView } from '../../src/shared/domain-model';
import type { SessionDraft } from '../../src/ui-engine';
import { createAppController, createEnginePorts } from '../../src/app/orchestrator';
import { stateWithDraft, testArtwork, validAppDraft } from './fixtures';

describe('Phase 10.5 orchestrator — real generation', () => {
  it('generates separate Output A and Output B prompts through the real engines', async () => {
    const controller = createAppController(testArtwork());
    const state = stateWithDraft(validAppDraft());
    const result = await controller.generate(state);
    expect(result.failures).toEqual([]);
    expect(result.phase).toBe('prompts-ready');
    expect(result.scenes).toHaveLength(2);
    const kinds = result.prompts.map((prompt) => prompt.kind);
    expect(kinds.filter((kind) => kind === 'A')).toHaveLength(2);
    expect(kinds.filter((kind) => kind === 'B')).toHaveLength(2);
    const a = result.prompts.find((prompt) => prompt.kind === 'A')!;
    const b = result.prompts.find((prompt) => prompt.kind === 'B')!;
    expect(a.promptText).toContain('[Output A]');
    expect(a.promptText).not.toContain('[Output B]');
    expect(b.promptText).toContain('[Output B]');
    expect(b.promptText).not.toContain('[Output A]');
    expect(a.promptText).toContain('blank');
    expect(b.sourceOutputAId).toBe(a.id);
  });

  it('is deterministic: the same draft yields byte-identical prompts', async () => {
    const first = await createAppController(testArtwork()).generate(
      stateWithDraft(validAppDraft()),
    );
    const second = await createAppController(testArtwork()).generate(
      stateWithDraft(validAppDraft()),
    );
    expect(first.prompts).toEqual(second.prompts);
    expect(first.scenes).toEqual(second.scenes);
  });

  it('generates A-only sessions without artwork when Output B is disabled', async () => {
    const controller = createAppController(null);
    const result = await controller.generate(
      stateWithDraft(validAppDraft({ includeOutputB: false })),
    );
    expect(result.failures).toEqual([]);
    expect(result.phase).toBe('prompts-ready');
    expect(result.prompts.every((prompt) => prompt.kind === 'A')).toBe(true);
  });

  it('fails closed with a typed failure when Output B is requested without artwork', async () => {
    const controller = createAppController(null);
    const result = await controller.generate(stateWithDraft(validAppDraft()));
    expect(result.phase).toBe('invalid');
    expect(result.prompts).toEqual([]);
    expect(result.failures.some((failure) => failure.code === 'UI_ARTWORK_REQUIRED')).toBe(true);
  });

  it('rejects an invalid form before invoking any engine', async () => {
    const controller = createAppController(null);
    const result = await controller.generate(
      stateWithDraft(validAppDraft({ title: '', includeOutputB: false })),
    );
    expect(result.phase).toBe('invalid');
    expect(result.failures.some((failure) => failure.code === 'UI_SESSION_NAME_REQUIRED')).toBe(
      true,
    );
  });

  it('supports the kids product with a kids audience', async () => {
    const controller = createAppController(null);
    const result = await controller.generate(
      stateWithDraft(
        validAppDraft({
          audience: Audience.Kids,
          includeOutputB: false,
          colorIds: ['color-white'] as unknown as SessionDraft['colorIds'],
          products: [
            {
              productId: 'product-kids-tee' as SessionDraft['products'][number]['productId'],
              quantity: 2,
              selectedViews: [GarmentView.Front],
              displayMethods: [DisplayMethod.OnModel],
            },
          ],
        }),
      ),
    );
    expect(result.failures).toEqual([]);
    expect(result.phase).toBe('prompts-ready');
  });

  it('exposes ports whose scene stage produces generated outputs (no pending placeholders)', async () => {
    const ports = createEnginePorts(testArtwork());
    const controller = createAppController(testArtwork());
    const result = await controller.generate(stateWithDraft(validAppDraft()));
    expect(ports.validation.validate(validAppDraft()).ok).toBe(true);
    for (const scene of result.scenes) {
      expect(scene.outputA.status).toBe('generated');
      expect(scene.outputA.promptText.length).toBeGreaterThan(0);
      expect(scene.outputB?.status).toBe('generated');
    }
  });
});
