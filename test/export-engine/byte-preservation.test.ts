import { describe, expect, it } from 'vitest';
import {
  encodeUtf8,
  formatCanonicalJson,
  formatMarkdown,
  formatReadableJson,
  formatTxt,
} from '../../src/export';
import { CANONICAL_GROUP_ID, CANONICAL_SESSION } from './fixtures';
import { createFormatterFixture } from './formatter-fixtures';

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, start = 0): number {
  outer: for (let offset = start; offset <= haystack.length - needle.length; offset += 1) {
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[offset + index] !== needle[index]) continue outer;
    }
    return offset;
  }
  return -1;
}

function txtPrompt(bytes: Uint8Array, label: string, prompt: string): Uint8Array {
  const marker = encodeUtf8(`----- BEGIN PROMPT ${JSON.stringify(label)} -----\n`);
  const offset = indexOfBytes(bytes, marker);
  expect(offset).toBeGreaterThanOrEqual(0);
  const start = offset + marker.byteLength;
  return bytes.slice(start, start + encodeUtf8(prompt).byteLength);
}

function markdownPrompt(bytes: Uint8Array, label: string, prompt: string): Uint8Array {
  const labelMarker = encodeUtf8(`Prompt label: ${JSON.stringify(label)}\n`);
  const labelOffset = indexOfBytes(bytes, labelMarker);
  expect(labelOffset).toBeGreaterThanOrEqual(0);
  const lengthMarker = encodeUtf8(`Prompt bytes: ${encodeUtf8(prompt).byteLength}\n`);
  const lengthOffset = indexOfBytes(bytes, lengthMarker, labelOffset + labelMarker.byteLength);
  expect(lengthOffset).toBeGreaterThanOrEqual(0);
  const fenceStart = lengthOffset + lengthMarker.byteLength;
  const promptStart = indexOfBytes(bytes, encodeUtf8('\n'), fenceStart) + 1;
  return bytes.slice(promptStart, promptStart + encodeUtf8(prompt).byteLength);
}

function parsedRecord(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected object');
  }
  return parsed as Record<string, unknown>;
}

function firstPrompt(
  document: Record<string, unknown>,
  field: 'outputsA' | 'outputsB' | 'groupPlans' | 'covers',
): string {
  const values = document[field];
  if (!Array.isArray(values) || values.length === 0) throw new Error(`Missing ${field}`);
  const first = values[0];
  if (first === null || typeof first !== 'object' || Array.isArray(first)) {
    throw new Error(`Invalid ${field}`);
  }
  const prompt = (first as Record<string, unknown>).promptText;
  if (typeof prompt !== 'string') throw new Error(`Missing promptText in ${field}`);
  return prompt;
}

describe('Exact prompt byte preservation across formatters', () => {
  const promptA = '  A e\u0301\r\nline A\r\n\n```A```\ntrailing-A  ';
  const promptB = '\tB العربية 🎨\rstandalone CR\n\ntrailing-B\t';
  const groupPrompt = ' GROUP\n\n~~~~\r\n````\nEND ';
  const coverPrompt = '\nCOVER <tag>\r\n# heading\n  ';

  it('preserves Output A bytes in TXT', () => {
    const result = formatTxt(createFormatterFixture({ promptA }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(txtPrompt(result.value.bytes, '1A', promptA)).toEqual(encodeUtf8(promptA));
  });

  it('preserves Output B bytes in TXT', () => {
    const result = formatTxt(createFormatterFixture({ promptB }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(txtPrompt(result.value.bytes, '1B', promptB)).toEqual(encodeUtf8(promptB));
  });

  it('preserves Group prompt bytes in TXT', () => {
    const result = formatTxt(createFormatterFixture({ groupPrompt }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(txtPrompt(result.value.bytes, `GROUP 1 (${CANONICAL_GROUP_ID})`, groupPrompt)).toEqual(
      encodeUtf8(groupPrompt),
    );
  });

  it('preserves Cover prompt bytes in TXT', () => {
    const coverId = CANONICAL_SESSION.cover?.id;
    expect(coverId).toBeDefined();
    if (!coverId) return;
    const result = formatTxt(createFormatterFixture({ coverPrompt }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(txtPrompt(result.value.bytes, `COVER (${coverId})`, coverPrompt)).toEqual(
      encodeUtf8(coverPrompt),
    );
  });

  it('preserves Output A and Output B bytes in Markdown', () => {
    const result = formatMarkdown(createFormatterFixture({ promptA, promptB }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(markdownPrompt(result.value.bytes, '1A', promptA)).toEqual(encodeUtf8(promptA));
    expect(markdownPrompt(result.value.bytes, '1B', promptB)).toEqual(encodeUtf8(promptB));
  });

  it('preserves Group and Cover prompt bytes in Markdown', () => {
    const coverId = CANONICAL_SESSION.cover?.id;
    expect(coverId).toBeDefined();
    if (!coverId) return;
    const result = formatMarkdown(createFormatterFixture({ groupPrompt, coverPrompt }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      markdownPrompt(result.value.bytes, `GROUP 1 (${CANONICAL_GROUP_ID})`, groupPrompt),
    ).toEqual(encodeUtf8(groupPrompt));
    expect(markdownPrompt(result.value.bytes, `COVER (${coverId})`, coverPrompt)).toEqual(
      encodeUtf8(coverPrompt),
    );
  });

  it('round-trips every prompt through readable JSON', () => {
    const result = formatReadableJson(
      createFormatterFixture({ promptA, promptB, groupPrompt, coverPrompt }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = parsedRecord(result.value.text);
    expect(firstPrompt(parsed, 'outputsA')).toBe(promptA);
    expect(firstPrompt(parsed, 'outputsB')).toBe(promptB);
    expect(firstPrompt(parsed, 'groupPlans')).toBe(groupPrompt);
    expect(firstPrompt(parsed, 'covers')).toBe(coverPrompt);
  });

  it('round-trips every prompt through canonical JSON', () => {
    const result = formatCanonicalJson(
      createFormatterFixture({ promptA, promptB, groupPrompt, coverPrompt }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = parsedRecord(result.value.text);
    expect(firstPrompt(parsed, 'outputsA')).toBe(promptA);
    expect(firstPrompt(parsed, 'outputsB')).toBe(promptB);
    expect(firstPrompt(parsed, 'groupPlans')).toBe(groupPrompt);
    expect(firstPrompt(parsed, 'covers')).toBe(coverPrompt);
  });

  it('does not normalize canonically equivalent Unicode prompt forms', () => {
    const nfc = formatCanonicalJson(createFormatterFixture({ promptA: 'é' }));
    const nfd = formatCanonicalJson(createFormatterFixture({ promptA: 'e\u0301' }));
    expect(nfc.ok).toBe(true);
    expect(nfd.ok).toBe(true);
    if (!nfc.ok || !nfd.ok) return;
    expect(nfc.value.bytes).not.toEqual(nfd.value.bytes);
  });

  it('does not add a newline inside a prompt that lacks one', () => {
    const prompt = 'no-final-newline  ';
    const result = formatTxt(createFormatterFixture({ promptA: prompt }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slice = txtPrompt(result.value.bytes, '1A', prompt);
    expect(slice).toEqual(encodeUtf8(prompt));
    expect(new TextDecoder().decode(slice).endsWith('\n')).toBe(false);
  });
});
