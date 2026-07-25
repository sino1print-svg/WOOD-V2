import { describe, expect, it } from 'vitest';
import { composeCover } from '../../src/engines/cover-engine';
import { coverInput } from './fixtures';

function prompt(digital = true, count = 4): string {
  const result = composeCover(coverInput({ digital, count }));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('fixture must compose');
  return result.value.promptText;
}

describe('Cover Engine source purity and premium doctrine', () => {
  it('emits the fixed cover sections in canonical order', () => {
    const text = prompt();
    const sections = [
      '[Global Rules]',
      '[Source Image Lock]',
      '[Canvas]',
      '[Layout]',
      '[Metadata]',
      '[Typography]',
      '[Image Placement]',
      '[Color Strip]',
      '[Badges]',
      '[Final Rules]',
    ];
    let previous = -1;
    for (const section of sections) {
      const current = text.indexOf(section);
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
  });

  it.each([
    'Output exactly one image',
    'Produce ONE cover image only',
    'Use ONLY the attached blank Sale Images (Output A)',
    'Never use any Preview (Output B)',
    'Preserve every source image EXACTLY',
    'do not regenerate',
    'redraw',
    'recolor',
    'recrop important areas',
    'stretch',
    'garments',
    'faces',
    'poses',
    'lighting',
    'folds',
    'backgrounds',
    'colors',
    'props',
    'Arrange the images only',
  ])('always includes source-lock directive: %s', (clause) => {
    expect(prompt()).toContain(clause);
  });

  it.each([
    'Warm neutral background',
    'Do NOT use a green background',
    'avoid dark side shadows',
    'Clean, uncluttered, generous white space',
    'Large mockups dominate the canvas',
    'Keep typography SMALL relative to the images',
    'Reserve proportional outer margins',
  ])('always includes premium doctrine: %s', (clause) => {
    expect(prompt()).toContain(clause);
  });

  it('uses only the concrete distinct Output A identifiers', () => {
    const text = prompt(true, 4);
    const sourceLock = text.match(/\[Source Image Lock\]([\s\S]*?)\n\n\[/)?.[1];
    expect(sourceLock).toBeDefined();
    for (const sourceId of ['1A', '2A', '3A', '4A']) {
      expect(sourceLock).toContain(sourceId);
    }
    expect(text).not.toContain('1B,');
    expect(text).not.toContain('2B,');
  });

  it('keeps all typography in cover chrome and away from garments', () => {
    const text = prompt();
    expect(text).toContain('No readable text on the garments');
    expect(text).toContain('Notice: "Designs shown are examples only"');
    expect(text).toContain('Software: "Compatible with common image editors"');
    expect(text).toContain('never invent brand claims');
  });

  it('includes every deterministic metadata typography field', () => {
    const text = prompt();
    expect(text).toContain('Header:');
    expect(text).toContain('Main Title:');
    expect(text).toContain('Subtitle:');
    expect(text).toContain('Views:');
    expect(text).toContain('Footer:');
    expect(text).toContain('Manifest Alpha Tee');
    expect(text).toContain('Father Day Season');
    expect(text).toContain('Adult');
  });

  it('includes digital lines and badges only for digital products', () => {
    const digital = prompt(true);
    expect(digital).toContain('Digital Download — No Physical Item');
    for (const badge of [
      'PNG Included',
      'Digital Download',
      'No Physical Item',
      'Editable',
      'Instant Download',
    ]) {
      expect(digital).toContain(badge);
    }

    const physical = prompt(false);
    for (const badge of [
      'Digital line',
      'digital-only',
      'PNG Included',
      'Digital Download',
      'No Physical Item',
      'Editable',
      'Instant Download',
    ]) {
      expect(physical).not.toContain(badge);
    }
  });

  it('always emits quality and commercial badges in deterministic order', () => {
    const text = prompt(false);
    const high = text.indexOf('High Resolution');
    const premium = text.indexOf('Premium Mockups');
    const commercial = text.indexOf('Commercial Use');
    expect(high).toBeGreaterThan(-1);
    expect(premium).toBeGreaterThan(high);
    expect(commercial).toBeGreaterThan(premium);
  });

  it('keeps the color strip subordinate and locked', () => {
    const text = prompt();
    expect(text).toContain('Locked garment colors only');
    expect(text).toContain('Keep the strip small and subordinate to the mockups');
    expect(text).toContain('White (#FFFFFF)');
    expect(text).toContain('Navy (#1F2A44)');
    expect(text).toContain('Sand (#D9C3A3)');
  });

  it('keeps a 50-mockup cover uncluttered and hero-dominant', () => {
    const text = prompt(true, 50);
    expect(text).toContain('grid 8x7');
    expect(text).toContain('hero image occupies a 2x2 span');
    expect(text).toContain('6 trailing empty cell(s)');
    expect(text).toContain('No clutter. Large mockups, small text');
    expect(text).toContain('smallest large-bundle tier');
    expect(text).toContain('minimum legible gutters for a large bundle');
  });

  it('scales typography and gutters deterministically from the source count', () => {
    expect(prompt(true, 4)).toContain('Typography scale = small tier');
    expect(prompt(true, 8)).toContain('Typography scale = smaller tier');
    expect(prompt(true, 20)).toContain('Typography scale = compact tier');
    expect(prompt(true, 50)).toContain('Typography scale = smallest large-bundle tier');
    expect(prompt(true, 20)).toContain('title size scales mildly and inversely');
    expect(prompt(true, 20)).toContain('Header > Main Title > Subtitle > Views > Footer/Badges');
  });

  it('contains no unresolved template variables', () => {
    const text = prompt();
    expect(text).not.toContain('{{');
    expect(text).not.toContain('}}');
  });
});
