/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import {
  UiController,
  createInitialUiState,
  deterministicFingerprint,
  validatePromptCollection,
  validateSceneCollection,
  validateUiStateInvariant,
} from '../../src/ui-engine';
import { catalog, ports, prompts, scene, validDraft } from './fixtures';

function clone<T>(value: T): T {
  return structuredClone(value);
}
function controllerWith(sceneValue: unknown, promptValue: unknown, calls = { prompt: 0 }) {
  const base = ports();
  return new UiController(
    {
      ...base,
      scene: { generate: () => ({ ok: true, value: sceneValue as any }) },
      prompt: {
        generate: () => {
          calls.prompt++;
          return { ok: true, value: promptValue as any };
        },
      },
    },
    catalog,
  );
}

describe('Phase 6 second corrective — deep runtime result validation', () => {
  const malformedScenes: readonly unknown[] = [
    [{ id: 'scene-0' }],
    ['not-a-scene'],
    [null],
    [{ ...clone(scene), extra: true }],
    [clone(scene), clone(scene)],
    [{ ...clone(scene), outputA: null }],
    [{ ...clone(scene), outputB: { ...clone(scene.outputB), sourceOutputAId: 'forged' } }],
    [{ ...clone(scene), outputB: { ...clone(scene.outputB), sourceHash: 'forged' } }],
    [{ ...clone(scene), outputB: { ...clone(scene.outputB), sourceContentHash: 'forged' } }],
    [{ ...clone(scene), outputA: { ...clone(scene.outputA), color: 'other' } }],
    [{ ...clone(scene), outputA: { ...clone(scene.outputA), view: 'back' } }],
  ];
  malformedScenes.forEach((value, index) => {
    it(`rejects malformed Scene result ${index + 1} before PromptPort`, async () => {
      const calls = { prompt: 0 };
      const result = await controllerWith(value, prompts, calls).generate(
        createInitialUiState(validDraft()),
      );
      expect(calls.prompt).toBe(0);
      expect(result.phase).not.toBe('scenes-ready');
      expect(result.phase).not.toBe('prompts-ready');
      expect(result.failures[0]?.code).toMatch(/^INVALID_SCENE_/);
    });
  });

  const malformedPrompts: readonly unknown[] = [
    [{ id: 'p-0', sceneId: 'scene-1', kind: 'A' }],
    ['not-a-prompt'],
    [null],
    [{ ...clone(prompts[0]), extra: true }, clone(prompts[1])],
    [clone(prompts[0]), clone(prompts[0])],
    [{ ...clone(prompts[0]), sceneId: 'missing' }, clone(prompts[1])],
    [clone(prompts[0]), { ...clone(prompts[1]), sourceOutputAId: 'forged' }],
    [clone(prompts[0]), { ...clone(prompts[1]), sourceHash: 'forged' }],
    [clone(prompts[0]), { ...clone(prompts[1]), sourceContentHash: 'forged' }],
    [{ ...clone(prompts[0]), productId: 'forged' }, clone(prompts[1])],
    [{ ...clone(prompts[0]), colorId: 'forged' }, clone(prompts[1])],
    [{ ...clone(prompts[0]), view: 'back' }, clone(prompts[1])],
    [{ ...clone(prompts[0]), printAreaProfileId: 'forged' }, clone(prompts[1])],
    [{ ...clone(prompts[0]), promptText: 7 }, clone(prompts[1])],
  ];
  malformedPrompts.forEach((value, index) => {
    it(`rejects malformed Prompt result ${index + 1}`, async () => {
      const result = await controllerWith([scene], value).generate(
        createInitialUiState(validDraft()),
      );
      expect(result.phase).not.toBe('prompts-ready');
      expect(result.prompts).toHaveLength(0);
      expect(result.selectedPromptId).toBeNull();
      expect(result.failures[0]?.code).toMatch(/^INVALID_PROMPT_/);
    });
  });

  it('preserves exact valid prompt text', async () => {
    const exact = prompts.map((p, i) => ({
      ...p,
      promptText: i ? '  عربي\r\n<script>x</script>  ' : '\nA\n\nB\t',
    }));
    const matchingScene = {
      ...clone(scene),
      outputA: { ...clone(scene.outputA), promptText: exact[0].promptText },
      outputB: { ...clone(scene.outputB), promptText: exact[1].promptText },
    };
    const result = await controllerWith([matchingScene], exact).generate(
      createInitialUiState(validDraft()),
    );
    expect(result.phase).toBe('prompts-ready');
    expect(result.prompts.map((p) => p.promptText)).toEqual(exact.map((p) => p.promptText));
  });

  it('deep state invariant rejects malformed nested generated values', () => {
    const fp = deterministicFingerprint(validDraft());
    const bad = {
      ...createInitialUiState(validDraft()),
      phase: 'prompts-ready' as const,
      step: 'review' as const,
      validatedFingerprint: fp,
      generatedFingerprint: fp,
      scenes: [{ id: 'x' } as any],
      prompts: [{ id: 'y' } as any],
      dirty: true,
    };
    expect(validateUiStateInvariant(bad).length).toBeGreaterThan(0);
  });

  it('validators accept deeply frozen valid collections without mutation', () => {
    const frozenScenes = Object.freeze([scene]);
    const frozenPrompts = Object.freeze(prompts.map(Object.freeze));
    expect(validateSceneCollection(frozenScenes, true).ok).toBe(true);
    expect(validatePromptCollection(frozenPrompts, frozenScenes, true).ok).toBe(true);
    expect(Object.isFrozen(frozenScenes)).toBe(true);
  });
});
