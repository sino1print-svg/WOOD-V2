import { describe, expect, it } from 'vitest';
import type { ContextFieldPath } from '../../src/shared/domain-model';
import { APP_CONFIG } from '../../src/config/app-config';
import { resolveContextPath } from '../../src/engines/rule-engine';
import { context, id } from './fixtures';

describe('ContextRef resolution and security', () => {
  it.each([
    ['session.requestedSceneCount', 4],
    ['scene.propIds', []],
    ['scene.isDuplicate', false],
    ['printArea.centeringOffset', 0],
    ['outputB.artworkId', 'artwork-1'],
  ])('resolves %s without falsy-value confusion', (path, expected) => {
    const result = resolveContextPath(
      context(),
      id<ContextFieldPath>(path),
      APP_CONFIG.limits.ruleEngine,
    );
    expect(result).toEqual({ ok: true, value: { present: true, value: expected } });
  });

  it.each([
    '__proto__.polluted',
    'session.__proto__',
    'session.constructor.prototype',
    'prototype.x',
    'session.missing',
    '',
  ])('rejects unauthorized or dangerous path %s', (path) => {
    const result = resolveContextPath(
      context(),
      id<ContextFieldPath>(path),
      APP_CONFIG.limits.ruleEngine,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('RULE_CFG_002');
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('enforces configured path length', () => {
    const result = resolveContextPath(context(), id<ContextFieldPath>('session.audience'), {
      ...APP_CONFIG.limits.ruleEngine,
      maxContextPathLength: 5,
    });
    expect(result.ok).toBe(false);
  });
});
