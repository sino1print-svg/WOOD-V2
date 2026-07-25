import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RuleOperator, type ContextFieldPath, type Rule } from '../../src/shared/domain-model';
import { validateProjectDocument } from '../../src/persistence';
import { evaluateRules, stableJson } from '../../src/engines/rule-engine';
import { createProject } from '../persistence/fixtures';
import { id, input, rule } from './fixtures';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function expectConfigFailure(result: ReturnType<typeof evaluateRules>, pathFragment: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.failures.some((failure) => failure.code === 'RULE_CFG_001')).toBe(true);
    expect(result.failures.some((failure) => failure.field.includes(pathFragment))).toBe(true);
  }
}

describe('AJV-backed Rule and RuleSet validation', () => {
  it('rejects a malformed Rule before accessing nested fields', () => {
    const malformed = { id: 'bad', priority: 5, domain: 'composition' } as unknown as Rule;
    expectConfigFailure(evaluateRules(input([malformed])), '/effect');
  });

  it('rejects unexpected nested condition properties with an exact path', () => {
    const malformed = rule({
      condition: {
        field: id<ContextFieldPath>('session.requestedSceneCount'),
        operator: RuleOperator.NumberGte,
        value: 1,
        unexpected: true,
      } as never,
    });
    expectConfigFailure(evaluateRules(input([malformed])), '/condition/unexpected');
  });

  it('rejects a supported-shape but non-current RuleSet version', () => {
    const r = rule();
    const data = input([r]);
    const legacy = { ...data.activeRuleSets[0]!, schemaVersion: 2 as never };
    expectConfigFailure(evaluateRules({ ...data, activeRuleSets: [legacy] }), '/schemaVersion');
  });

  it('rejects malformed RuleSet schemaVersion deterministically', () => {
    const r = rule();
    const data = input([r]);
    const malformed = {
      ...data.activeRuleSets[0]!,
      schemaVersion: '3',
    } as never;
    expectConfigFailure(evaluateRules({ ...data, activeRuleSets: [malformed] }), '/schemaVersion');
  });

  it('treats Rule.description as human-readable metadata only', () => {
    const base = rule({ description: 'RULE_PA_001 RULE_AUD_001' });
    const translated = rule({ ...base, description: 'وصف بشري مترجم بلا دلالة آلية' });
    expect(stableJson(evaluateRules(input([base])))).toBe(
      stableJson(evaluateRules(input([translated]))),
    );
  });
});

describe('runtime-only and pure-core guarantees', () => {
  it('CORRECTIVE #7: evaluatedAt echoes the caller-supplied IsoTimestamp (was: schema redefined to null)', () => {
    // OLD (incorrect) expectation: RuleTrace.evaluatedAt was redefined from IsoTimestamp to a
    // literal `null` type to sidestep RULE_TRACE_EVALUATED_AT_CONTRADICTION (pure core cannot
    // call a clock). That is a schema change, which the corrective release forbids.
    // NEW (correct) expectation: the schema is restored to `evaluatedAt: IsoTimestamp`
    // (03_DATA_MODELS_FINAL §3.14, 04_RULE_ENGINE_REVISED §15). Purity is preserved instead by
    // making the caller inject the timestamp via RuleEngineInput.evaluatedAt, so the same
    // inputs (including the timestamp) always produce the same output.
    // Source: docs/spec/03_DATA_MODELS_FINAL.md §3.14; docs/spec/04_RULE_ENGINE_REVISED.md §15.
    const data = input([rule()]);
    const result = evaluateRules(data);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.trace.evaluatedAt).toBe(data.evaluatedAt);
  });

  it('Project schema rejects RuleTrace as runtime-only application state', () => {
    const evaluated = evaluateRules(input([rule()]));
    expect(evaluated.ok).toBe(true);
    const project = createProject() as unknown as Record<string, unknown>;
    project.ruleTrace = evaluated.ok ? evaluated.value.trace : null;
    const validation = validateProjectDocument(project);
    expect(validation.ok).toBe(false);
  });

  it('production Rule Engine source contains no time, randomness, code evaluation, logging, or I/O imports', () => {
    const directory = path.join(ROOT, 'src', 'engines', 'rule-engine');
    const source = readdirSync(directory)
      .filter((name) => name.endsWith('.ts'))
      .sort()
      .map((name) => readFileSync(path.join(directory, name), 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/\bDate\s*\./u);
    expect(source).not.toMatch(/\bnew\s+Date\s*\(/u);
    expect(source).not.toMatch(/\bperformance\.now\s*\(/u);
    expect(source).not.toContain('resultCodeFromDescription');
    expect(source).not.toMatch(/description\s*\.\s*match\s*\([^)]*RULE_/u);
    expect(source).not.toMatch(/RULE_.*description|description.*RULE_/u);
    expect(source).not.toMatch(/\bnew\s+Date\b/u);
    expect(source).not.toContain('Math.random');
    expect(source).not.toMatch(/\beval\s*\(/u);
    expect(source).not.toMatch(/\bFunction\s*\(/u);
    expect(source).not.toContain('console.');
    expect(source).not.toMatch(/from ['"]node:/u);
    expect(source).not.toMatch(/from ['"](?:fs|path|http|https|net|child_process)['"]/u);
  });
});
