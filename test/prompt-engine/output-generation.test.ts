import { describe, expect, it } from 'vitest';
import { composeOutputA, composeOutputB } from '../../src/engines/prompt-engine';
import { inputA, inputB } from './fixtures';

describe('Prompt Engine output generation', () => {
  it('generates a meaningful blank sale prompt in canonical order', () => {
    const result = composeOutputA(inputA());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = result.value.promptText;
    expect(result.value.outputLabel).toBe('1A');
    expect(result.value.sections).toEqual(['global', 'product', 'season', 'scene', 'output']);
    expect(text.indexOf('[Global]')).toBeLessThan(text.indexOf('[Product]'));
    expect(text.indexOf('[Product]')).toBeLessThan(text.indexOf('[Season]'));
    expect(text.indexOf('[Season]')).toBeLessThan(text.indexOf('[Scene]'));
    expect(text.indexOf('[Scene]')).toBeLessThan(text.indexOf('[Output A]'));
    expect(text).toContain('exactly one image');
    expect(text).toContain('Do NOT create a collage');
    expect(text).toContain('completely blank');
    expect(text).toContain('White');
    expect(text).toContain('Halloween');
    expect(text).toContain('top-down flat lay');
    expect(text).toContain('front view');
    expect(text).toContain('center chest printable area');
    expect(text).toContain('no watermark');
  });

  it('generates a matching edit prompt with full source and artwork locks', () => {
    const result = composeOutputB(inputB());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = result.value.promptText;
    expect(result.value.outputLabel).toBe('1B');
    expect(text).toContain('Image EDIT');
    expect(text).toContain('attached matching Output A image (1A)');
    expect(text).toContain('ONLY print artwork');
    for (const term of [
      'model',
      'face',
      'pose',
      'crop',
      'background',
      'lighting',
      'camera angle',
      'product',
      'garment shape',
      'garment color',
      'fabric folds',
      'shadows',
      'props',
      'composition',
    ]) {
      expect(text).toContain(term);
    }
    for (const term of [
      'redraw',
      'recolor',
      'replace',
      'enhance',
      'reinterpret',
      'translate',
      'invent',
      'destructively crop',
    ]) {
      expect(text).toContain(term);
    }
    for (const term of [
      'wrinkles',
      'garment drape',
      'fabric microtexture',
      'natural perspective',
      'sticker effect',
      'flat pasted image',
      'white box',
      'checkerboard',
    ]) {
      expect(text).toContain(term);
    }
  });
});
