/**
 * Phase 10.5 — Export command tests.
 * The UI export path must run through the official Export Engine plan and
 * formatters, produce deterministic bytes, and fail closed without a valid
 * generation result.
 */
import { describe, expect, it } from 'vitest';
import { createExportPlan } from '../../src/engines/export-engine';
import {
  formatCanonicalJson,
  formatMarkdown,
  formatReadableJson,
  formatTxt,
} from '../../src/export';
import {
  EXPORT_FILE_NAMES,
  buildExportDocuments,
  buildExportEngineInput,
} from '../../src/app/commands';
import { createAppController } from '../../src/app/orchestrator';
import { createInitialUiState } from '../../src/ui-engine';
import type { UiState } from '../../src/ui-engine';
import { stateWithDraft, testArtwork, validAppDraft } from './fixtures';

async function generatedState(): Promise<UiState> {
  const result = await createAppController(testArtwork()).generate(stateWithDraft(validAppDraft()));
  if (result.phase !== 'prompts-ready') throw new Error('generation failed in fixture');
  return result;
}

describe('Phase 10.5 export command', () => {
  it('produces TXT, Markdown, readable JSON, and canonical JSON documents', async () => {
    const state = await generatedState();
    const result = buildExportDocuments(state, testArtwork());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.documents.map((entry) => entry.kind)).toEqual([
      'txt',
      'markdown',
      'readable_json',
      'canonical_json',
    ]);
    for (const entry of result.documents) {
      expect(entry.document.byteLength).toBeGreaterThan(0);
      expect(entry.document.bytes[0]).not.toBe(0xef);
    }
  });

  it('uses deterministic file names', async () => {
    const state = await generatedState();
    const result = buildExportDocuments(state, testArtwork());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.documents.map((entry) => entry.fileName)).toEqual([
      'prompt-pack.txt',
      'prompt-pack.md',
      'prompt-pack.json',
      'prompt-pack.canonical.json',
    ]);
    expect(EXPORT_FILE_NAMES.txt).toBe('prompt-pack.txt');
  });

  it('returns bytes identical to the official formatters (no re-implementation)', async () => {
    const state = await generatedState();
    const input = buildExportEngineInput(state, testArtwork());
    const planResult = createExportPlan(input);
    expect(planResult.ok).toBe(true);
    const result = buildExportDocuments(state, testArtwork());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const official = [
      formatTxt({ planResult, limits: input.limits }),
      formatMarkdown({ planResult, limits: input.limits }),
      formatReadableJson({ planResult, limits: input.limits }),
      formatCanonicalJson({ planResult, limits: input.limits }),
    ];
    for (const [index, formatted] of official.entries()) {
      expect(formatted.ok).toBe(true);
      if (!formatted.ok) continue;
      expect(result.documents[index]!.document.bytes).toEqual(formatted.value.bytes);
    }
  });

  it('embeds prompts literally (A then B) in the exported JSON', async () => {
    const state = await generatedState();
    const result = buildExportDocuments(state, testArtwork());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const json = result.documents.find((entry) => entry.kind === 'readable_json')!;
    const parsed = JSON.parse(json.document.text) as Record<string, unknown>;
    expect(parsed).toBeTypeOf('object');
    const text = json.document.text;
    const promptA = state.prompts.find((prompt) => prompt.kind === 'A')!;
    const promptB = state.prompts.find((prompt) => prompt.kind === 'B')!;
    expect(text).toContain(JSON.stringify(promptA.promptText).slice(1, 40));
    expect(text).toContain(JSON.stringify(promptB.promptText).slice(1, 40));
    const aIndex = text.indexOf('"outputsA"');
    const bIndex = text.indexOf('"outputsB"');
    expect(aIndex).toBeGreaterThan(-1);
    expect(bIndex).toBeGreaterThan(aIndex);
  });

  it('is byte-for-byte deterministic across two identical generations', async () => {
    const first = buildExportDocuments(await generatedState(), testArtwork());
    const second = buildExportDocuments(await generatedState(), testArtwork());
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    for (let index = 0; index < first.documents.length; index += 1) {
      expect(first.documents[index]!.document.bytes).toEqual(
        second.documents[index]!.document.bytes,
      );
    }
  });

  it('fails closed with a typed failure when no valid result exists', () => {
    const result = buildExportDocuments(createInitialUiState(), null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0]!.code).toBe('UI_EXPORT_NOT_READY');
    expect(result).not.toHaveProperty('documents');
  });
});
