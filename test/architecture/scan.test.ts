/**
 * Scanner self-tests (deterministic): detects every import form, resolves tsconfig
 * aliases, and FAILS CLOSED on unresolved internal aliases (never treats an internal
 * alias as an external package).
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { REPO_ROOT, SRC, extractRefs, isInternalAliasSpec, loadAliases, resolveSpec } from './scan';

const aliases = loadAliases(path.join(REPO_ROOT, 'tsconfig.json'));

describe('import scanner', () => {
  it('extracts static, re-export, side-effect, dynamic, and require refs', () => {
    const src = [
      "import a from './static-mod';",
      "export { b } from './reexport-mod';",
      "import './side-effect-mod';",
      "const c = await import('./dynamic-mod');",
      "const d = require('./require-mod');",
      "import { x } from '@shared/domain-model';",
    ].join('\n');
    const refs = extractRefs(src);
    const byKind = (k: string): string[] => refs.filter((r) => r.kind === k).map((r) => r.spec);
    expect(byKind('static')).toEqual(
      expect.arrayContaining(['./static-mod', '@shared/domain-model']),
    );
    expect(byKind('reexport')).toContain('./reexport-mod');
    expect(byKind('sideEffect')).toContain('./side-effect-mod');
    expect(byKind('dynamic')).toContain('./dynamic-mod');
    expect(byKind('require')).toContain('./require-mod');
  });

  it('resolves tsconfig aliases to real files', () => {
    expect(aliases.length).toBeGreaterThanOrEqual(5);
    const from = path.join(SRC, 'engines', 'rule-engine', 'index.ts');
    expect(resolveSpec(from, '@shared/domain-model', aliases)).toContain(
      path.join('shared', 'domain-model'),
    );
    expect(resolveSpec(from, '@ui/app-shell/AppShell', aliases)).toContain(
      path.join('ui', 'app-shell'),
    );
  });

  it('classifies external packages as external (null, not internal)', () => {
    const from = path.join(SRC, 'main.tsx');
    expect(resolveSpec(from, 'react', aliases)).toBeNull();
    expect(isInternalAliasSpec('react', aliases)).toBe(false);
    expect(isInternalAliasSpec('react-dom/client', aliases)).toBe(false);
  });

  it('FAILS CLOSED: an unresolved INTERNAL alias is internal, not external', () => {
    const from = path.join(SRC, 'engines', 'rule-engine', 'index.ts');
    // Alias-prefixed but points to a non-existent file:
    expect(isInternalAliasSpec('@shared/does-not-exist', aliases)).toBe(true);
    expect(resolveSpec(from, '@shared/does-not-exist', aliases)).toBeNull();
    // -> scan() records this as unresolvedInternal (a violation), never as external.
  });

  it('resolves relative specifiers to real files', () => {
    const from = path.join(SRC, 'shared', 'errors', 'index.ts');
    expect(resolveSpec(from, './registry', aliases)).toContain(
      path.join('shared', 'errors', 'registry.ts'),
    );
  });
});
