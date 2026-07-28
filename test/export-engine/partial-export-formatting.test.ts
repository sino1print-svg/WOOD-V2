import { describe, expect, it } from 'vitest';
import { createExportPlan } from '../../src/engines/export-engine';
import {
  formatCanonicalJson,
  formatMarkdown,
  formatReadableJson,
  formatTxt,
  type ExportFormatResult,
  type ExportFormatterInput,
} from '../../src/export';
import type { ExportEngineInput } from '../../src/shared/contracts';
import { OutputStatus, type Project } from '../../src/shared/domain-model';
import {
  CANONICAL_EXPORT_INPUT,
  CANONICAL_PROJECT,
  CANONICAL_SCENE_ID,
  CANONICAL_SCOPES,
  CANONICAL_SESSION_ID,
} from './fixtures';
import { createFormatterFixture, formatterInputFromEngine } from './formatter-fixtures';

const FORMATTERS: readonly ((input: ExportFormatterInput) => ExportFormatResult)[] = [
  formatTxt,
  formatMarkdown,
  formatReadableJson,
  formatCanonicalJson,
];

function parsed(text: string): Record<string, unknown> {
  const value = JSON.parse(text) as unknown;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected JSON object');
  }
  return value as Record<string, unknown>;
}

function staleFormatterInput(): ExportFormatterInput {
  const project: Project = structuredClone(CANONICAL_PROJECT);
  const scene = project.sessions[CANONICAL_SESSION_ID]?.scenes[CANONICAL_SCENE_ID];
  if (scene?.outputB) scene.outputB.status = OutputStatus.Stale;
  const engineInput: ExportEngineInput = {
    ...CANONICAL_EXPORT_INPUT,
    source: { ...CANONICAL_EXPORT_INPUT.source, project },
  };
  return formatterInputFromEngine(engineInput);
}

describe('Partial export representation', () => {
  it('marks every successful document as partial when Batch 10.2 did so', () => {
    const input = createFormatterFixture({ omitOutputB: true });
    for (const formatter of FORMATTERS) {
      const result = formatter(input);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.value.metadata.partial).toBe(true);
      expect(result.value.byteLength).toBeGreaterThan(0);
    }
  });

  it('never reintroduces an omitted Output B', () => {
    const input = createFormatterFixture({ omitOutputB: true });
    const txt = formatTxt(input);
    const markdown = formatMarkdown(input);
    const readable = formatReadableJson(input);
    const canonical = formatCanonicalJson(input);
    expect(txt.ok && txt.value.text.includes('OUTPUT B PROMPTS')).toBe(false);
    expect(markdown.ok && markdown.value.text.includes('## Output B Prompts')).toBe(false);
    expect(readable.ok).toBe(true);
    expect(canonical.ok).toBe(true);
    if (!readable.ok || !canonical.ok) return;
    expect(parsed(readable.value.text).outputsB).toEqual([]);
    expect(parsed(canonical.value.text).outputsB).toEqual([]);
  });

  it('carries the same omission code and order into readable and canonical JSON', () => {
    const input = createFormatterFixture({ omitOutputB: true, groupPrompt: null });
    const readable = formatReadableJson(input);
    const canonical = formatCanonicalJson(input);
    expect(readable.ok).toBe(true);
    expect(canonical.ok).toBe(true);
    if (!readable.ok || !canonical.ok) return;
    expect(parsed(readable.value.text).omissions).toEqual(parsed(canonical.value.text).omissions);
  });

  it('shows every omission in both text formats', () => {
    const input = createFormatterFixture({ omitOutputB: true, groupPrompt: null });
    expect(input.planResult.ok).toBe(true);
    if (!input.planResult.ok) return;
    const txt = formatTxt(input);
    const markdown = formatMarkdown(input);
    expect(txt.ok).toBe(true);
    expect(markdown.ok).toBe(true);
    if (!txt.ok || !markdown.ok) return;
    for (const omission of input.planResult.value.omissions) {
      expect(txt.value.text).toContain(omission.code);
      expect(txt.value.text).toContain(omission.entityId);
      expect(markdown.value.text).toContain(omission.code);
      expect(markdown.value.text).toContain(omission.entityId);
    }
  });

  it('keeps warning severity unchanged for stale Output B', () => {
    const input = staleFormatterInput();
    expect(input.planResult.ok).toBe(true);
    if (!input.planResult.ok) return;
    const issue = input.planResult.value.issues.find(
      (candidate) => candidate.code === 'EXPORT_STALE_001',
    );
    expect(issue?.severity).toBe('warning');
    const readable = formatReadableJson(input);
    expect(readable.ok).toBe(true);
    if (!readable.ok) return;
    const warnings = parsed(readable.value.text).warnings;
    expect(Array.isArray(warnings)).toBe(true);
    if (!Array.isArray(warnings)) return;
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: 'EXPORT_STALE_001', severity: 'warning' }),
    );
  });

  it('does not convert blocking omission severity to warning', () => {
    const result = formatReadableJson(createFormatterFixture({ omitOutputB: true }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const omissions = parsed(result.value.text).omissions;
    expect(Array.isArray(omissions)).toBe(true);
    if (!Array.isArray(omissions)) return;
    expect(omissions[0]).toEqual(
      expect.objectContaining({ code: 'EXPORT_SCOPE_002', severity: 'blocking' }),
    );
  });

  it('propagates fully blocked planning failures with no document bytes', () => {
    const project: Project = structuredClone(CANONICAL_PROJECT);
    const outputB = project.sessions[CANONICAL_SESSION_ID]?.scenes[CANONICAL_SCENE_ID]?.outputB;
    if (outputB) {
      const scene = project.sessions[CANONICAL_SESSION_ID]?.scenes[CANONICAL_SCENE_ID];
      if (scene) {
        scene.outputB = {
          ...outputB,
          sourceOutputAId: 'wrong-output-a' as typeof outputB.sourceOutputAId,
        };
      }
    }
    const engineInput: ExportEngineInput = {
      ...CANONICAL_EXPORT_INPUT,
      source: { ...CANONICAL_EXPORT_INPUT.source, project },
      scope: CANONICAL_SCOPES[1],
    };
    const input: ExportFormatterInput = {
      planResult: createExportPlan(engineInput),
      limits: engineInput.limits,
    };
    for (const formatter of FORMATTERS) {
      const result = formatter(input);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.failures.map((failure) => failure.code)).toContain('EXPORT_LINK_001');
      expect('value' in result).toBe(false);
    }
  });

  it('does not mutate omission or issue arrays while formatting', () => {
    const input = createFormatterFixture({ omitOutputB: true, groupPrompt: null });
    const before = JSON.stringify(input.planResult);
    for (const formatter of FORMATTERS) formatter(input);
    expect(JSON.stringify(input.planResult)).toBe(before);
  });
});
