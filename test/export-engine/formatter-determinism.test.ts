import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatCanonicalJson,
  formatMarkdown,
  formatReadableJson,
  formatTxt,
  type ExportFormatResult,
  type ExportFormatterInput,
} from '../../src/export';
import type {
  ExportNumberingEntry,
  ExportOrderedSelectionReference,
  ExportPlan,
} from '../../src/shared/contracts';
import {
  cloneFormatterInput,
  createFormatterFixture,
  createMultiSceneFormatterFixture,
} from './formatter-fixtures';

const FORMATTERS: readonly ((input: ExportFormatterInput) => ExportFormatResult)[] = [
  formatTxt,
  formatMarkdown,
  formatReadableJson,
  formatCanonicalJson,
];

function createHundredPromptInput(): ExportFormatterInput {
  const fixture = cloneFormatterInput(createFormatterFixture());
  if (!fixture.planResult.ok) return fixture;
  const original = fixture.planResult.value;
  const baseScene = original.selection.scenes[0];
  const baseA = original.selection.outputsA[0];
  const baseB = original.selection.outputsB[0];
  const session = original.selection.sessions[0];
  if (!baseScene || !baseA || !baseB || !session) return fixture;

  const scenes: (typeof original.selection.scenes)[number][] = [];
  const outputsA: (typeof original.selection.outputsA)[number][] = [];
  const outputsB: (typeof original.selection.outputsB)[number][] = [];
  const numbering: ExportNumberingEntry[] = [];
  const ordered: ExportOrderedSelectionReference[] = [];
  const phase1: (typeof original.selection.executionPlans)[number]['phase1'][number][] = [];
  const phase2: (typeof original.selection.executionPlans)[number]['phase2'][number][] = [];

  for (let index = 0; index < 50; index += 1) {
    const number = index + 1;
    const sceneId = `scene-stress-${number}` as typeof baseScene.id;
    const outputAId = `output-a-stress-${number}` as typeof baseA.id;
    const outputBId = `output-b-stress-${number}` as typeof baseB.id;
    const labelA = `${number}A` as typeof baseA.label;
    const labelB = `${number}B` as typeof baseB.label;
    scenes.push({
      ...baseScene,
      id: sceneId,
      sceneHash: number.toString(16).padStart(64, '0') as typeof baseScene.sceneHash,
      sceneFingerprint: (number + 100)
        .toString(16)
        .padStart(64, '0') as typeof baseScene.sceneFingerprint,
    });
    outputsA.push({
      ...baseA,
      id: outputAId,
      sceneId,
      sceneNumber: number,
      label: labelA,
      promptText: `Stress Output A ${number}`,
    });
    outputsB.push({
      ...baseB,
      id: outputBId,
      sceneId,
      sceneNumber: number,
      label: labelB,
      sourceOutputAId: outputAId,
      sourceOutputALabel: labelA,
      promptText: `Stress Output B ${number}`,
    });
    numbering.push({
      sessionId: session.id,
      sceneId,
      sceneNumber: number,
      outputAId,
      outputALabel: labelA,
      outputBId,
      outputBLabel: labelB,
    });
    phase1.push({ sceneId, outputAId, label: labelA });
    phase2.push({
      sceneId,
      outputBId,
      label: labelB,
      sourceOutputAId: outputAId,
      sourceOutputALabel: labelA,
    });
  }
  ordered.push(
    ...scenes.map((scene) => ({
      kind: 'scene' as const,
      entityId: scene.id,
      sessionId: session.id,
      sceneId: scene.id,
    })),
    ...outputsA.map((output) => ({
      kind: 'output_a' as const,
      entityId: output.id,
      sessionId: session.id,
      sceneId: output.sceneId,
      label: output.label,
    })),
    ...outputsB.map((output) => ({
      kind: 'output_b' as const,
      entityId: output.id,
      sessionId: session.id,
      sceneId: output.sceneId,
      label: output.label,
    })),
    { kind: 'execution_plan', entityId: session.id, sessionId: session.id },
  );

  const sceneIds = scenes.map((scene) => scene.id);
  const plan: ExportPlan = {
    scope: {
      ...original.scope,
      groupIds: [],
      sceneIds,
      outputAIds: outputsA.map((output) => output.id),
      outputBIds: outputsB.map((output) => output.id),
      coverIds: [],
    },
    numbering,
    groupNumbering: [],
    selection: {
      ...original.selection,
      sessions: [
        {
          ...session,
          requestedSceneCount: 50,
          sceneIds,
          generationProgress: {
            totalScenes: 50,
            outputAGenerated: 50,
            outputBGenerated: 50,
            coverGenerated: false,
            allOutputAReady: true,
          },
        },
      ],
      groups: [],
      groupPlans: [],
      scenes,
      outputsA,
      outputsB,
      covers: [],
      executionPlans: [{ sessionId: session.id, phase1, phase2 }],
      ordered,
    },
    omissions: [],
    issues: [],
    partial: false,
  };
  return {
    planResult: { ok: true, value: plan },
    limits: fixture.limits,
  };
}

describe('Formatter determinism and limits', () => {
  it('produces identical strings and bytes on consecutive runs for every format', () => {
    const input = createMultiSceneFormatterFixture();
    for (const formatter of FORMATTERS) {
      expect(formatter(input)).toEqual(formatter(input));
    }
  });

  it('produces identical bytes from distinct object identities', () => {
    const first = createMultiSceneFormatterFixture();
    const second = createMultiSceneFormatterFixture();
    for (const formatter of FORMATTERS) {
      expect(formatter(first)).toEqual(formatter(second));
    }
  });

  it('is independent of root key insertion order', () => {
    const input = createFormatterFixture();
    if (!input.planResult.ok) return;
    const plan = input.planResult.value;
    const reordered = {
      ok: true,
      value: {
        partial: plan.partial,
        issues: plan.issues,
        omissions: plan.omissions,
        selection: plan.selection,
        groupNumbering: plan.groupNumbering,
        numbering: plan.numbering,
        scope: plan.scope,
      },
    } as const;
    for (const formatter of FORMATTERS) {
      expect(formatter(input)).toEqual(formatter({ planResult: reordered, limits: input.limits }));
    }
  });

  it('is independent of process timezone', () => {
    const previous = process.env.TZ;
    const input = createFormatterFixture();
    process.env.TZ = 'UTC';
    const utc = FORMATTERS.map((formatter) => formatter(input));
    process.env.TZ = 'Africa/Cairo';
    const cairo = FORMATTERS.map((formatter) => formatter(input));
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
    expect(cairo).toEqual(utc);
  });

  it('is independent of process locale variables', () => {
    const previous = process.env.LANG;
    const input = createFormatterFixture();
    process.env.LANG = 'C';
    const cLocale = FORMATTERS.map((formatter) => formatter(input));
    process.env.LANG = 'ar_EG.UTF-8';
    const arabicLocale = FORMATTERS.map((formatter) => formatter(input));
    if (previous === undefined) delete process.env.LANG;
    else process.env.LANG = previous;
    expect(arabicLocale).toEqual(cLocale);
  });

  it('contains no time, randomness, locale, or filesystem-order dependency', () => {
    const root = path.resolve('src/export');
    const source = readdirSync(root)
      .filter((name) => name.endsWith('.ts'))
      .sort()
      .map((name) => readFileSync(path.join(root, name), 'utf8'))
      .join('\n');
    for (const forbidden of [
      'Date.now',
      'Math.random',
      'localeCompare',
      'Intl.',
      'readdir',
      'readFile',
      'process.env',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('formats 50 scenes and 100 prompts within approved bounds', () => {
    const input = createHundredPromptInput();
    const readable = formatReadableJson(input);
    const canonical = formatCanonicalJson(input);
    const txt = formatTxt(input);
    const markdown = formatMarkdown(input);
    for (const result of [readable, canonical, txt, markdown]) {
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.byteLength).toBeLessThan(input.limits.maxArtifactBytes);
    }
    if (!readable.ok) return;
    const document = JSON.parse(readable.value.text) as {
      scenes: unknown[];
      outputsA: unknown[];
      outputsB: unknown[];
    };
    expect(document.scenes).toHaveLength(50);
    expect(document.outputsA).toHaveLength(50);
    expect(document.outputsB).toHaveLength(50);
  });

  it('accepts a large prompt within the configured byte limit without truncation', () => {
    const prompt = `BEGIN\n${'x'.repeat(1024 * 1024)}\nEND`;
    const result = formatCanonicalJson(createFormatterFixture({ promptA: prompt }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = JSON.parse(result.value.text) as {
      outputsA: readonly { promptText: string }[];
    };
    expect(parsed.outputsA[0]?.promptText).toBe(prompt);
  });

  it('fails with a typed storage error when the array-count limit is exceeded', () => {
    const input = createMultiSceneFormatterFixture();
    const result = formatCanonicalJson({
      planResult: input.planResult,
      limits: { ...input.limits, maxZipEntries: 1 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map((failure) => failure.code)).toEqual(['EXPORT_STORAGE_001']);
  });

  it('fails with a typed storage error when the depth limit is exceeded', () => {
    const input = createFormatterFixture();
    const result = formatReadableJson({
      planResult: input.planResult,
      limits: { ...input.limits, maxJsonDepth: 2 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map((failure) => failure.code)).toEqual(['EXPORT_STORAGE_001']);
  });

  it('returns fresh bytes so caller mutation cannot affect later runs', () => {
    const input = createFormatterFixture();
    const first = formatCanonicalJson(input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    first.value.bytes[0] = 0;
    const second = formatCanonicalJson(input);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.bytes[0]).toBe(123);
  });
});
