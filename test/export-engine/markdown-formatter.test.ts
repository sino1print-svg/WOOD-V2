import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodeUtf8, formatMarkdown, formatTxt, hasUtf8Bom } from '../../src/export';
import { CANONICAL_SCOPES } from './fixtures';
import {
  cloneFormatterInput,
  createFormatterFixture,
  createMultiSceneFormatterFixture,
} from './formatter-fixtures';

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, start = 0): number {
  outer: for (let offset = start; offset <= haystack.length - needle.length; offset += 1) {
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[offset + index] !== needle[index]) continue outer;
    }
    return offset;
  }
  return -1;
}

function promptBytesFromMarkdown(bytes: Uint8Array, label: string, byteLength: number): Uint8Array {
  const labelMarker = encodeUtf8(`Prompt label: ${JSON.stringify(label)}\n`);
  const labelOffset = indexOfBytes(bytes, labelMarker);
  expect(labelOffset).toBeGreaterThanOrEqual(0);
  const lengthMarker = encodeUtf8(`Prompt bytes: ${byteLength}\n`);
  const lengthOffset = indexOfBytes(bytes, lengthMarker, labelOffset + labelMarker.byteLength);
  expect(lengthOffset).toBeGreaterThanOrEqual(0);
  const fenceStart = lengthOffset + lengthMarker.byteLength;
  const fenceEnd = indexOfBytes(bytes, encodeUtf8('\n'), fenceStart);
  expect(fenceEnd).toBeGreaterThanOrEqual(fenceStart);
  const promptStart = fenceEnd + 1;
  return bytes.slice(promptStart, promptStart + byteLength);
}

describe('Markdown formatter', () => {
  it('is an independent Markdown document rather than renamed TXT', () => {
    const input = createFormatterFixture();
    const markdown = formatMarkdown(input);
    const txt = formatTxt(input);
    expect(markdown.ok).toBe(true);
    expect(txt.ok).toBe(true);
    if (!markdown.ok || !txt.ok) return;
    expect(markdown.value.text).not.toBe(txt.value.text);
    expect(markdown.value.text.startsWith('# Mockup Photoshoot Director Export\n')).toBe(true);
    expect(markdown.value.mediaType).toBe('text/markdown;charset=utf-8');
    expect(markdown.value.suggestedExtension).toBe('md');
  });

  it('uses exactly one fixed level-one heading', () => {
    const result = formatMarkdown(createFormatterFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text.match(/^# /gmu)).toHaveLength(1);
    expect(result.value.text).toContain('## Metadata');
    expect(result.value.text).toContain('## Output A Prompts');
    expect(result.value.text).toContain('## Output B Prompts');
  });

  it('preserves hostile Markdown-looking prompt content byte-for-byte', () => {
    const prompt =
      '  # heading\r\n```lang\n<secret-tag attr="x">\n~~~~\n````\nالعربية 🎨\n> quote\n- item  ';
    const result = formatMarkdown(createFormatterFixture({ promptA: prompt }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expected = encodeUtf8(prompt);
    expect(promptBytesFromMarkdown(result.value.bytes, '1A', expected.byteLength)).toEqual(
      expected,
    );
  });

  it('selects a backtick fence longer than every run inside the prompt', () => {
    const prompt = '```\n````\n``````\n~~~';
    const result = formatMarkdown(createFormatterFixture({ promptA: prompt }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lines = result.value.text.split('\n');
    const markerIndex = lines.indexOf(`Prompt bytes: ${encodeUtf8(prompt).byteLength}`);
    expect(markerIndex).toBeGreaterThan(-1);
    expect(lines[markerIndex + 1]).toBe('```````');
  });

  it('does not transform prompt lines into bullets, quotes, or escaped HTML', () => {
    const prompt = '- literal bullet\n> literal quote\n<div>literal html</div>';
    const result = formatMarkdown(createFormatterFixture({ promptA: prompt }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toContain(prompt);
    expect(result.value.text).not.toContain('\\<div\\>');
    expect(result.value.text).not.toContain('> - literal bullet');
  });

  it('generates no HTML framing', () => {
    const source = readFileSync(path.resolve('src/export/markdown.ts'), 'utf8');
    expect(source).not.toContain('<!--');
    expect(source).not.toContain('<div');
    expect(source).not.toContain('<pre');
  });

  it('keeps all A prompts before all B prompts and cover last', () => {
    const result = formatMarkdown(createMultiSceneFormatterFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const outputA = result.value.text.indexOf('## Output A Prompts');
    const outputB = result.value.text.indexOf('## Output B Prompts');
    const cover = result.value.text.indexOf('## Cover');
    expect(outputA).toBeGreaterThan(-1);
    expect(outputB).toBeGreaterThan(outputA);
    expect(cover).toBeGreaterThan(outputB);
  });

  it('omits sections unavailable to an Output-A-only scope', () => {
    const result = formatMarkdown(createFormatterFixture({ scope: CANONICAL_SCOPES[0] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toContain('## Output A Prompts');
    expect(result.value.text).not.toContain('## Output B Prompts');
    expect(result.value.text).not.toContain('## Cover');
    expect(result.value.text).not.toContain('## Groups');
  });

  it('represents partial omissions and warnings without changing eligibility', () => {
    const result = formatMarkdown(createFormatterFixture({ omitOutputB: true }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.metadata.partial).toBe(true);
    expect(result.value.text).toContain('## Omissions');
    expect(result.value.text).toContain('Code EXPORT_SCOPE_002');
    expect(result.value.text).not.toContain('## Output B Prompts');
  });

  it('uses no BOM and one final LF', () => {
    const result = formatMarkdown(createFormatterFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(hasUtf8Bom(result.value.bytes)).toBe(false);
    expect(result.value.text.endsWith('\n')).toBe(true);
    expect(result.value.text.endsWith('\n\n')).toBe(false);
  });

  it('returns a typed failure instead of truncating an oversized document', () => {
    const input = cloneFormatterInput(createFormatterFixture());
    const result = formatMarkdown({
      planResult: input.planResult,
      limits: { ...input.limits, maxArtifactBytes: 64 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map((failure) => failure.code)).toEqual(['EXPORT_STORAGE_001']);
    expect('value' in result).toBe(false);
  });

  it('is byte-identical across repeated calls', () => {
    const input = createFormatterFixture({ promptA: 'same 🎨\r\nbytes  ' });
    const first = formatMarkdown(input);
    const second = formatMarkdown(input);
    expect(first).toEqual(second);
  });
});
