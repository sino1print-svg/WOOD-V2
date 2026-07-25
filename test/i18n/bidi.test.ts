/**
 * Bidi isolation checks (deterministic) — UI §18 / IMPL §48.
 * English prompt content must stay LTR-isolated within the Arabic RTL UI.
 */
import { describe, it, expect } from 'vitest';
import {
  LRI,
  PDI,
  PROMPT_DIRECTION,
  UI_DIRECTION,
  isLtrIsolated,
  isolateLtr,
} from '../../src/shared/i18n';

describe('bidi isolation', () => {
  it('UI is RTL and prompt content is LTR', () => {
    expect(UI_DIRECTION).toBe('rtl');
    expect(PROMPT_DIRECTION).toBe('ltr');
  });

  it('isolateLtr wraps text with LRI ... PDI', () => {
    const out = isolateLtr('One prompt = one image.');
    expect(out.startsWith(LRI)).toBe(true);
    expect(out.endsWith(PDI)).toBe(true);
    expect(out).toContain('One prompt = one image.');
  });

  it('isLtrIsolated recognizes isolated content and rejects raw content', () => {
    expect(isLtrIsolated(isolateLtr('abc'))).toBe(true);
    expect(isLtrIsolated('abc')).toBe(false);
  });

  it('is deterministic (same input -> same output)', () => {
    expect(isolateLtr('x')).toBe(isolateLtr('x'));
  });
});
