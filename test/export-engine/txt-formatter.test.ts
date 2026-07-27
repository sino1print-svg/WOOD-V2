import { describe, expect, it } from 'vitest';
import { createExportPlan } from '../../src/engines/export-engine';
import { encodeUtf8, formatTxt, hasUtf8Bom } from '../../src/export';
import type { ExportEngineInput } from '../../src/shared/contracts';
import type { Project } from '../../src/shared/domain-model';
import {
  CANONICAL_EXPORT_INPUT,
  CANONICAL_PROJECT,
  CANONICAL_SCENE_ID,
  CANONICAL_SCOPES,
  CANONICAL_SESSION_ID,
} from './fixtures';
import {
  cloneFormatterInput,
  createFormatterFixture,
  createMultiSceneFormatterFixture,
} from './formatter-fixtures';

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let offset = 0; offset <= haystack.length - needle.length; offset += 1) {
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[offset + index] !== needle[index]) continue outer;
    }
    return offset;
  }
  return -1;
}

function promptBytesFromTxt(bytes: Uint8Array, label: string, byteLength: number): Uint8Array {
  const marker = encodeUtf8(`----- BEGIN PROMPT ${JSON.stringify(label)} -----\n`);
  const markerOffset = indexOfBytes(bytes, marker);
  expect(markerOffset).toBeGreaterThanOrEqual(0);
  const start = markerOffset + marker.byteLength;
  return bytes.slice(start, start + byteLength);
}

describe('TXT formatter', () => {
  it('returns the typed TXT delivery shape', () => {
    const result = formatTxt(createFormatterFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.format).toBe('txt');
    expect(result.value.mediaType).toBe('text/plain;charset=utf-8');
    expect(result.value.suggestedExtension).toBe('txt');
    expect(result.value.byteLength).toBe(result.value.bytes.byteLength);
    expect(result.value.metadata.scopeDetail).toBe('session');
  });

  it('orders Output A before Output B and the cover after both', () => {
    const result = formatTxt(createFormatterFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const a = result.value.text.indexOf('OUTPUT A PROMPTS');
    const b = result.value.text.indexOf('OUTPUT B PROMPTS');
    const cover = result.value.text.indexOf('================ COVER ================');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(cover).toBeGreaterThan(b);
  });

  it('uses canonical scene ordering for a multi-scene document', () => {
    const result = formatTxt(createMultiSceneFormatterFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text.indexOf('PROMPT "1A"')).toBeLessThan(
      result.value.text.indexOf('PROMPT "2A"'),
    );
    expect(result.value.text.indexOf('PROMPT "2A"')).toBeLessThan(
      result.value.text.indexOf('PROMPT "1B"'),
    );
    expect(result.value.text.indexOf('PROMPT "1B"')).toBeLessThan(
      result.value.text.indexOf('PROMPT "2B"'),
    );
  });

  it('exposes the stable nA/nB numbering map', () => {
    const result = formatTxt(createFormatterFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toContain('1A=');
    expect(result.value.text).toContain('1B=');
    expect(result.value.text).toContain('1.1-A=');
    expect(result.value.text).toContain('1.1-B=');
  });

  it('preserves an opaque prompt byte-for-byte inside its boundaries', () => {
    const prompt = '  العربية 🎨\r\nline two\rline three\n\ntrailing  ';
    const result = formatTxt(createFormatterFixture({ promptA: prompt }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expected = encodeUtf8(prompt);
    expect(promptBytesFromTxt(result.value.bytes, '1A', expected.byteLength)).toEqual(expected);
  });

  it('adds LF-only framing while retaining CR bytes owned by the prompt', () => {
    const prompt = 'A\r\nB\rC';
    const result = formatTxt(createFormatterFixture({ promptA: prompt }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const withoutPrompt = result.value.text.replace(prompt, '');
    expect(withoutPrompt).not.toContain('\r');
    expect(result.value.text).toContain(prompt);
  });

  it('uses no BOM and exactly one final LF', () => {
    const result = formatTxt(createFormatterFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(hasUtf8Bom(result.value.bytes)).toBe(false);
    expect(result.value.text.endsWith('\n')).toBe(true);
    expect(result.value.text.endsWith('\n\n')).toBe(false);
  });

  it('omits empty decorative sections for an Output-A-only scope', () => {
    const result = formatTxt(createFormatterFixture({ scope: CANONICAL_SCOPES[0] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toContain('OUTPUT A PROMPTS');
    expect(result.value.text).not.toContain('OUTPUT B PROMPTS');
    expect(result.value.text).not.toContain('================ GROUPS ================');
    expect(result.value.text).not.toContain('================ COVER ================');
  });

  it('represents every partial omission with code, severity, identifier, and location', () => {
    const result = formatTxt(createFormatterFixture({ omitOutputB: true }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.metadata.partial).toBe(true);
    expect(result.value.text).toContain('================ OMISSIONS ================');
    expect(result.value.text).toContain('CODE EXPORT_SCOPE_002');
    expect(result.value.text).toContain('SEVERITY blocking');
    expect(result.value.text).toContain('KIND output_b');
    expect(result.value.text).toContain('LOCATION');
  });

  it('propagates a blocking planner failure without bytes', () => {
    const project: Project = structuredClone(CANONICAL_PROJECT);
    const scene = project.sessions[CANONICAL_SESSION_ID]?.scenes[CANONICAL_SCENE_ID];
    if (scene?.outputB) {
      scene.outputB = {
        ...scene.outputB,
        sourceOutputAId: 'broken-output-a' as typeof scene.outputB.sourceOutputAId,
      };
    }
    const engineInput: ExportEngineInput = {
      ...CANONICAL_EXPORT_INPUT,
      source: { ...CANONICAL_EXPORT_INPUT.source, project },
      scope: CANONICAL_SCOPES[1],
    };
    const result = formatTxt({
      planResult: createExportPlan(engineInput),
      limits: engineInput.limits,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map((failure) => failure.code)).toContain('EXPORT_LINK_001');
    expect('value' in result).toBe(false);
  });

  it('returns a typed size failure without truncated bytes', () => {
    const input = cloneFormatterInput(createFormatterFixture());
    const result = formatTxt({
      planResult: input.planResult,
      limits: { ...input.limits, maxArtifactBytes: 64 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map((failure) => failure.code)).toEqual(['EXPORT_STORAGE_001']);
    expect('value' in result).toBe(false);
  });

  it('does not mutate the approved plan', () => {
    const input = createFormatterFixture();
    const before = JSON.stringify(input.planResult);
    formatTxt(input);
    expect(JSON.stringify(input.planResult)).toBe(before);
  });
});
