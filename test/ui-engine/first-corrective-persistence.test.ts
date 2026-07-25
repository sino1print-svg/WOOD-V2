/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import {
  UiController,
  createInitialUiState,
  parseUiState,
  serializeUiState,
} from '../../src/ui-engine';
import { catalog, ports, validDraft } from './fixtures';

async function generatedState() {
  return new UiController(ports(), catalog).generate(createInitialUiState(validDraft()));
}

describe('Phase 6 first corrective persisted-state validation', () => {
  it('round-trips a fully generated valid state', async () => {
    const state = await generatedState();
    const parsed = parseUiState(serializeUiState(state));
    expect(parsed.ok).toBe(true);
  });
  it.each([
    ['prompts-ready without scenes', (s: any) => ({ ...s, scenes: [] })],
    ['prompts-ready without prompts', (s: any) => ({ ...s, prompts: [] })],
    [
      'forged output A link',
      (s: any) => ({
        ...s,
        prompts: s.prompts.map((p: any) =>
          p.kind === 'B' ? { ...p, sourceOutputAId: 'forged' } : p,
        ),
      }),
    ],
    [
      'forged scene id',
      (s: any) => ({
        ...s,
        prompts: s.prompts.map((p: any) => (p.kind === 'B' ? { ...p, sceneId: 'forged' } : p)),
      }),
    ],
    [
      'forged source hash',
      (s: any) => ({
        ...s,
        prompts: s.prompts.map((p: any) => (p.kind === 'B' ? { ...p, sourceHash: 'forged' } : p)),
      }),
    ],
    [
      'forged source content hash',
      (s: any) => ({
        ...s,
        prompts: s.prompts.map((p: any) =>
          p.kind === 'B' ? { ...p, sourceContentHash: 'forged' } : p,
        ),
      }),
    ],
    [
      'duplicate prompt id',
      (s: any) => ({ ...s, prompts: [s.prompts[0], { ...s.prompts[1], id: s.prompts[0].id }] }),
    ],
    [
      'duplicate scene id',
      (s: any) => ({ ...s, scenes: [s.scenes[0], structuredClone(s.scenes[0])] }),
    ],
    ['invalid selected output', (s: any) => ({ ...s, selectedPromptId: 'missing' })],
    ['missing generated fingerprint', (s: any) => ({ ...s, generatedFingerprint: null })],
    [
      'negative active request',
      (s: any) => ({
        ...s,
        phase: 'generating-scenes',
        step: 'generation',
        activeRequestSequence: -1,
      }),
    ],
    ['dirty persisted contradiction', (s: any) => ({ ...s, dirty: true, persisted: true })],
    ['unknown top-level property', (s: any) => ({ ...s, unknownField: true })],
    ['unknown nested property', (s: any) => ({ ...s, draft: { ...s.draft, unknownField: true } })],
    ['impossible phase step', (s: any) => ({ ...s, phase: 'idle', step: 'review' })],
    ['stale marked current', (s: any) => ({ ...s, draft: { ...s.draft, title: 'changed' } })],
    ['invalid count', (s: any) => ({ ...s, draft: { ...s.draft, targetCount: -1 } })],
    ['invalid enum', (s: any) => ({ ...s, draft: { ...s.draft, mode: 'unknown' } })],
    ['unknown schema', (s: any) => ({ ...s, schemaVersion: 2 })],
    ['malformed nested draft', (s: any) => ({ ...s, draft: {} })],
  ])('rejects %s', async (_name, mutate) => {
    const state = await generatedState();
    expect(parseUiState(JSON.stringify(mutate(structuredClone(state)))).ok).toBe(false);
  });
});
