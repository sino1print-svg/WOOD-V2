/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import {
  UiController,
  createInitialUiState,
  resetForm,
  type GenerationOwnership,
} from '../../src/ui-engine';
import { catalog, colorId, ports, validDraft } from './fixtures';

describe('Phase 6 first corrective authoritative pipeline and ownership', () => {
  it('passes exact resolved outputs through the typed scene plan and scenes to prompt', async () => {
    const base = ports();
    let received: any;
    let promptScenes: any;
    let promptPlan: any;
    const rules = Object.freeze([{ id: 'resolved-rule' }]);
    const palette = Object.freeze([colorId]);
    const printArea = Object.freeze({ profileId: 'resolved-profile' });
    const controller = new UiController(
      {
        ...base,
        rule: { evaluate: () => ({ ok: true, value: rules }) },
        palette: { resolve: () => ({ ok: true, value: palette }) },
        printArea: { resolve: () => ({ ok: true, value: printArea }) },
        scene: {
          generate: (plan) => {
            received = plan;
            return base.scene.generate(plan);
          },
        },
        prompt: {
          generate: (scenes, plan) => {
            promptScenes = scenes;
            promptPlan = plan;
            return base.prompt.generate(scenes, plan);
          },
        },
      },
      catalog,
    );
    const result = await controller.generate(createInitialUiState(validDraft()));
    expect(result.phase).toBe('prompts-ready');
    expect(received.rules).toEqual(rules);
    expect(received.palette).toEqual(palette);
    expect(received.printArea).toEqual(printArea);
    expect(received.draft).not.toBe(validDraft());
    expect(promptScenes).toEqual(result.scenes);
    expect(promptPlan).toBe(received);
  });

  it('does not invoke later ports after an earlier failure', async () => {
    let scene = 0,
      prompt = 0;
    const base = ports();
    const controller = new UiController(
      {
        ...base,
        palette: {
          resolve: () => ({
            ok: false,
            failures: [{ code: 'X', field: 'x', message: 'x', severity: 'blocking' } as any],
          }),
        },
        scene: {
          generate: () => {
            scene++;
            return { ok: true, value: [] };
          },
        },
        prompt: {
          generate: () => {
            prompt++;
            return { ok: true, value: [] };
          },
        },
      },
      catalog,
    );
    await controller.generate(createInitialUiState(validDraft()));
    expect(scene).toBe(0);
    expect(prompt).toBe(0);
  });

  it('discards a delayed scene result after reset', async () => {
    let release!: () => void;
    const base = ports();
    let current = createInitialUiState(validDraft());
    const ownership: GenerationOwnership = {
      getCurrentState: () => current,
      publishPending: (s) => {
        current = s;
      },
      publishFailure: () => undefined,
    };
    const controller = new UiController(
      {
        ...base,
        scene: {
          generate: async (plan) => {
            await new Promise<void>((r) => {
              release = r;
            });
            return base.scene.generate(plan);
          },
        },
      },
      catalog,
    );
    const pending = controller.generate(current, ownership);
    current = resetForm(current);
    release();
    const result = await pending;
    expect(result).toBe(current);
    expect(result.phase).toBe('idle');
  });

  it('discards a delayed prompt result after restore/new state', async () => {
    let release!: () => void;
    const base = ports();
    let current = createInitialUiState(validDraft());
    const ownership: GenerationOwnership = {
      getCurrentState: () => current,
      publishPending: (s) => {
        current = s;
      },
      publishFailure: () => undefined,
    };
    const controller = new UiController(
      {
        ...base,
        prompt: {
          generate: async (scenes, plan) => {
            await new Promise<void>((r) => {
              release = r;
            });
            return base.prompt.generate(scenes, plan);
          },
        },
      },
      catalog,
    );
    const pending = controller.generate(current, ownership);
    while (current.phase !== 'generating-prompts') await Promise.resolve();
    current = createInitialUiState({ ...validDraft(), title: 'restored' });
    release();
    const result = await pending;
    expect(result).toBe(current);
    expect(result.draft.title).toBe('restored');
  });

  it('allows presentation-only state replacement that preserves ownership fields', async () => {
    let release!: () => void;
    const base = ports();
    let current = createInitialUiState(validDraft());
    const ownership: GenerationOwnership = {
      getCurrentState: () => current,
      publishPending: (s) => {
        current = s;
      },
      publishFailure: () => undefined,
    };
    const controller = new UiController(
      {
        ...base,
        scene: {
          generate: async (plan) => {
            await new Promise<void>((r) => {
              release = r;
            });
            return base.scene.generate(plan);
          },
        },
      },
      catalog,
    );
    const pending = controller.generate(current, ownership);
    current = { ...current };
    release();
    const result = await pending;
    expect(result.phase).toBe('prompts-ready');
  });
});
