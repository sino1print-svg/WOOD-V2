import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppShell } from '../../src/ui/app-shell/AppShell';

function files(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const target = path.join(root, name);
    return statSync(target).isDirectory() ? files(target) : [target];
  });
}

describe('Phase 6 security, accessibility, and architecture', () => {
  it('renders Arabic RTL with semantic controls and labels', () => {
    const html = renderToStaticMarkup(<AppShell />);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
    expect(html).toContain('<main');
    expect(html).toContain('<label');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="التنقل الرئيسي"');
  });

  it('does not use unsafe HTML rendering', () => {
    const sourceFiles = files('src/ui').concat(files('src/ui-engine'));
    for (const file of sourceFiles)
      expect(readFileSync(file, 'utf8')).not.toContain('dangerouslySetInnerHTML');
  });

  it('does not import engine internals or later-phase engines', () => {
    const source = files('src/ui')
      .concat(files('src/ui-engine'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/engines\/(rule|palette|print-area|scene|prompt)-engine\//u);
    expect(source).not.toMatch(/cover-engine|export-engine/u);
  });

  it('does not use nondeterministic APIs in UI state/orchestration', () => {
    const source = files('src/ui-engine')
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/Date\.now|new Date|Math\.random|randomUUID|localeCompare/u);
  });

  it('contains no hidden automatic generation effect', () => {
    const source = readFileSync('src/ui/app-shell/AppShell.tsx', 'utf8');
    expect(source).not.toContain('useEffect');
    expect(source).toContain('onClick={validate}');
  });

  it('contains no Phase 7 cover/export implementation in the UI', () => {
    const source = files('src/ui')
      .concat(files('src/ui-engine'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/composeCover|cover template|ZIP export|marketplace publishing/u);
  });
});
