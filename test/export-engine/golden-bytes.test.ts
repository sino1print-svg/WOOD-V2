import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  encodeUtf8,
  formatCanonicalJson,
  formatMarkdown,
  formatReadableJson,
  formatTxt,
  hasUtf8Bom,
  type ExportFormatResult,
  type ExportFormatterInput,
} from '../../src/export';
import { createGoldenCases, GOLDEN_CASE_NAMES } from './golden-cases';
import {
  GOLDEN_DIGESTS,
  GOLDEN_FORMAT_NAMES,
  type GoldenFormatName,
} from './golden/expected-digests';

const FORMATTERS: Readonly<
  Record<GoldenFormatName, (input: ExportFormatterInput) => ExportFormatResult>
> = {
  txt: formatTxt,
  markdown: formatMarkdown,
  readableJson: formatReadableJson,
  canonicalJson: formatCanonicalJson,
};

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sourcePrompts(input: ExportFormatterInput): readonly string[] {
  if (!input.planResult.ok) return [];
  const selection = input.planResult.value.selection;
  return [
    ...selection.outputsA.map((item) => item.promptText),
    ...selection.outputsB.map((item) => item.promptText),
    ...selection.groupPlans.map((item) => item.promptText),
    ...selection.covers.map((item) => item.promptText),
  ];
}

function jsonPrompts(text: string): readonly string[] {
  const root = JSON.parse(text) as {
    readonly outputsA: readonly { readonly promptText: string }[];
    readonly outputsB: readonly { readonly promptText: string }[];
    readonly groupPlans: readonly { readonly promptText: string }[];
    readonly covers: readonly { readonly promptText: string }[];
  };
  return [
    ...root.outputsA.map((item) => item.promptText),
    ...root.outputsB.map((item) => item.promptText),
    ...root.groupPlans.map((item) => item.promptText),
    ...root.covers.map((item) => item.promptText),
  ];
}

function removeOpaquePrompts(text: string, prompts: readonly string[]): string {
  let framing = text;
  for (const prompt of prompts) framing = framing.replaceAll(prompt, '');
  return framing;
}

describe('Golden formatter bytes', () => {
  it('locks exactly the fifteen reviewed fixture identities', () => {
    expect(createGoldenCases().map((fixture) => fixture.name)).toEqual(GOLDEN_CASE_NAMES);
    expect(Object.keys(GOLDEN_DIGESTS)).toEqual([...GOLDEN_CASE_NAMES]);
  });

  for (const fixture of createGoldenCases()) {
    it(`matches reviewed byte oracles for ${fixture.name}`, () => {
      const prompts = sourcePrompts(fixture.input);
      for (const formatName of GOLDEN_FORMAT_NAMES) {
        const formatter = FORMATTERS[formatName];
        const first = formatter(fixture.input);
        const second = formatter(fixture.input);
        expect(first).toEqual(second);
        expect(first.ok).toBe(true);
        if (!first.ok) continue;

        const expected = GOLDEN_DIGESTS[fixture.name][formatName];
        expect(first.value.byteLength).toBe(expected.byteLength);
        expect(first.value.bytes.byteLength).toBe(expected.byteLength);
        expect(sha256(first.value.bytes)).toBe(expected.sha256);
        expect(first.value.bytes).toEqual(encodeUtf8(first.value.text));
        expect(hasUtf8Bom(first.value.bytes)).toBe(false);

        if (formatName === 'txt' || formatName === 'markdown') {
          expect(removeOpaquePrompts(first.value.text, prompts)).not.toContain('\r');
          for (const prompt of prompts) {
            expect(first.value.text.includes(prompt)).toBe(true);
          }
        } else {
          expect(first.value.text).not.toContain('\r');
          expect(jsonPrompts(first.value.text)).toEqual(prompts);
        }
      }

      if (fixture.name === 'hostile-metadata-legitimate-prompt') {
        for (const formatName of GOLDEN_FORMAT_NAMES) {
          const result = FORMATTERS[formatName](fixture.input);
          if (result.ok) {
            expect(result.value.text).not.toContain('RUNTIME-METADATA-MUST-NOT-LEAK');
          }
        }
      }
    });
  }
});
