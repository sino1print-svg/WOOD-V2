/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import {
  createInitialUiState,
  deterministicFingerprint,
  parseUiState,
  transitionUiState,
  validatePromptCollection,
  validateSceneCollection,
} from '../../src/ui-engine';
import { prompts, scene, validDraft } from './fixtures';

function generatingScenes() {
  const fp = deterministicFingerprint(validDraft());
  return {
    ...createInitialUiState(validDraft()),
    phase: 'generating-scenes' as const,
    step: 'generation' as const,
    validatedFingerprint: fp,
    requestSequence: 1,
    activeRequestSequence: 1,
  };
}

describe('Phase 6 second corrective — narrow success events', () => {
  it('success event contracts contain no complete state payload', () => {
    const source = transitionUiState.toString();
    expect(source).not.toContain('event.state');
  });
  it('rejects arbitrary full-state Scene success injection', () => {
    const result = transitionUiState(generatingScenes(), {
      type: 'SCENE_GENERATION_SUCCEEDED',
      state: createInitialUiState(),
    } as any);
    expect(result.ok).toBe(false);
  });
  it('rejects wrong scene request sequence and fingerprint', () => {
    const validated = validateSceneCollection([scene], true);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(
      transitionUiState(generatingScenes(), {
        type: 'SCENE_GENERATION_SUCCEEDED',
        requestSequence: 2,
        generationFingerprint: deterministicFingerprint(validDraft()),
        scenes: validated.value,
      }).ok,
    ).toBe(false);
    expect(
      transitionUiState(generatingScenes(), {
        type: 'SCENE_GENERATION_SUCCEEDED',
        requestSequence: 1,
        generationFingerprint: 'wrong',
        scenes: validated.value,
      }).ok,
    ).toBe(false);
  });
  it('constructs only authoritative scenes-ready state', () => {
    const validated = validateSceneCollection([scene], true);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const current = generatingScenes();
    const fp = deterministicFingerprint(validDraft());
    const result = transitionUiState(current, {
      type: 'SCENE_GENERATION_SUCCEEDED',
      requestSequence: 1,
      generationFingerprint: fp,
      scenes: validated.value,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.phase).toBe('scenes-ready');
    expect(result.value.step).toBe('generation');
    expect(result.value.draft).toEqual(current.draft);
    expect(result.value.prompts).toEqual([]);
  });
  it('Prompt success cannot replace scenes or inject a complete state', () => {
    const vs = validateSceneCollection([scene], true);
    expect(vs.ok).toBe(true);
    if (!vs.ok) return;
    const fp = deterministicFingerprint(validDraft());
    const state = {
      ...generatingScenes(),
      phase: 'generating-prompts' as const,
      scenes: vs.value,
      generatedFingerprint: fp,
    };
    expect(
      transitionUiState(state, {
        type: 'PROMPT_GENERATION_SUCCEEDED',
        state: createInitialUiState(),
      } as any).ok,
    ).toBe(false);
    const vp = validatePromptCollection(prompts, vs.value, true);
    expect(vp.ok).toBe(true);
    if (!vp.ok) return;
    const result = transitionUiState(state, {
      type: 'PROMPT_GENERATION_SUCCEEDED',
      requestSequence: 1,
      generationFingerprint: fp,
      prompts: vp.value,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.phase).toBe('prompts-ready');
    expect(result.value.step).toBe('review');
    expect(result.value.scenes).toEqual(vs.value);
  });
  it('rejects caller-created unvalidated restore state', () => {
    expect(
      transitionUiState(createInitialUiState(), {
        type: 'SESSION_RESTORED',
        validatedState: createInitialUiState(),
      } as any).ok,
    ).toBe(false);
  });
  it('accepts only persistence-validated restored state', () => {
    const initial = {
      ...createInitialUiState(validDraft()),
      phase: 'editing' as const,
      dirty: true,
    };
    const parsed = parseUiState(JSON.stringify(initial));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(
      transitionUiState(createInitialUiState(), {
        type: 'SESSION_RESTORED',
        validatedState: parsed.value,
      }).ok,
    ).toBe(true);
  });
});
