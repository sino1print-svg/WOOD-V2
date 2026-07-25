import { describe, expect, it } from 'vitest';
import {
  canonicalPromptOrder,
  copyExact,
  createInitialUiState,
  formatPromptBundle,
  parseUiState,
  serializeUiState,
} from '../../src/ui-engine';
import { prompts, validDraft } from './fixtures';

describe('Phase 6 copy and persistence', () => {
  it('copies exact selected prompt bytes', async () => {
    let copied = '';
    const failure = await copyExact(
      {
        writeText: async (text) => {
          copied = text;
        },
      },
      prompts[0].promptText,
    );
    expect(failure).toBeNull();
    expect(copied).toBe('Output A exact');
  });

  it('reports clipboard rejection as a typed failure', async () => {
    const failure = await copyExact(
      {
        writeText: async () => {
          throw new Error('denied');
        },
      },
      'text',
    );
    expect(failure?.code).toBe('UI_CLIPBOARD_FAILED');
  });

  it('orders A before B and scenes canonically', () => {
    const reversed = [...prompts].reverse();
    expect(canonicalPromptOrder(reversed).map((item) => item.id)).toEqual(['1A', '1B']);
  });

  it('keeps outputs separated in group copy', () => {
    const bundle = formatPromptBundle(prompts);
    expect(bundle).toContain('===== 1A =====\nOutput A exact');
    expect(bundle).toContain('===== 1B =====\nOutput B exact');
    expect(bundle).not.toContain('Output A exactOutput B exact');
  });

  it('round-trips canonical UI-owned state', () => {
    const state = createInitialUiState(validDraft());
    const parsed = parseUiState(serializeUiState(state));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual(state);
  });

  it.each(['{', '[]', '{}', '{"schemaVersion":2,"draft":{},"scenes":[],"prompts":[]}'])(
    'rejects corrupt persisted state %s',
    (text) => {
      expect(parseUiState(text).ok).toBe(false);
    },
  );
});
