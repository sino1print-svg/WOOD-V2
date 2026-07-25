/**
 * Architecture import scanner + boundary checks (deterministic, test-only helper).
 *
 * Detects every internal import form:
 *   - static:      import x from './m'   /   import { y } from '@shared/...'
 *   - re-export:   export { y } from './m'
 *   - side-effect: import './m'
 *   - dynamic:     import('./m')
 *   - require:     require('./m')
 * Resolves relative specifiers AND tsconfig path aliases (@shared, @app, @engines,
 * @ui, @config). Alias imports are NEVER silently treated as external: an internal
 * specifier (relative OR alias-prefixed) that fails to resolve is reported as an
 * `UnresolvedRef` so the boundary tests FAIL CLOSED.
 *
 * Enforces the complete permission matrix (10_APP_WORKFLOW §2.3–§2.4; IMPL §8):
 *   - engines/shared/app/persistence/export/config must not import the UI layer;
 *   - engine->engine imports match the matrix (leaves import no engine;
 *     Scene->{rule,palette,print-area,dedup}; Validation->{rule,print-area};
 *     prompt/cover/export import no engine);
 *   - Persistence and Asset (leaf infrastructure) import no engine and no UI, and
 *     may import only shared + config (+ self);
 *   - no engine imports the Orchestrator (app);
 *   - the graph is acyclic.
 *
 * All checks are PURE functions over an edge list so tests can feed synthetic
 * forbidden-import fixtures and assert they are flagged.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..');
export const SRC = path.join(REPO_ROOT, 'src');

export type ImportKind = 'static' | 'reexport' | 'sideEffect' | 'dynamic' | 'require';

export interface ImportEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: ImportKind;
  readonly spec: string;
}

export interface UnresolvedRef {
  readonly from: string;
  readonly spec: string;
  readonly kind: ImportKind;
}

export interface RawRef {
  readonly spec: string;
  readonly kind: ImportKind;
}

interface AliasEntry {
  readonly prefix: string;
  readonly targetBase: string;
}

export function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path.resolve(full));
  }
  return out;
}

export function loadAliases(tsconfigPath: string): AliasEntry[] {
  const raw = readFileSync(tsconfigPath, 'utf8');
  const parsed = JSON.parse(raw) as {
    compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
  };
  const baseUrl = parsed.compilerOptions?.baseUrl ?? '.';
  const paths = parsed.compilerOptions?.paths ?? {};
  const entries: AliasEntry[] = [];
  for (const [key, targets] of Object.entries(paths)) {
    const first = targets[0];
    if (!first) continue;
    const prefix = key.endsWith('/*') ? key.slice(0, -1) : key + '/';
    const targetRel = first.endsWith('/*') ? first.slice(0, -1) : first;
    const targetBase = path.resolve(REPO_ROOT, baseUrl, targetRel) + path.sep;
    entries.push({ prefix, targetBase });
  }
  return entries.sort((a, b) => b.prefix.length - a.prefix.length);
}

export function aliasPrefixes(aliases: AliasEntry[]): string[] {
  return aliases.map((a) => a.prefix);
}

export function isInternalAliasSpec(spec: string, aliases: AliasEntry[]): boolean {
  return aliases.some((a) => spec === a.prefix.slice(0, -1) || spec.startsWith(a.prefix));
}

export function extractRefs(source: string): RawRef[] {
  const refs: RawRef[] = [];
  const push = (spec: string | undefined, kind: ImportKind): void => {
    if (spec) refs.push({ spec, kind });
  };
  const fromRe = /\b(import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(source)) !== null) push(m[2], m[1] === 'export' ? 'reexport' : 'static');
  const sideRe = /(?:^|[^.\w])import\s*['"]([^'"]+)['"]/g;
  while ((m = sideRe.exec(source)) !== null) push(m[1], 'sideEffect');
  const dynRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dynRe.exec(source)) !== null) push(m[1], 'dynamic');
  const reqRe = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = reqRe.exec(source)) !== null) push(m[1], 'require');
  return refs;
}

function tryResolveFile(base: string): string | null {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return path.resolve(c);
  }
  return null;
}

export function resolveSpec(fromFile: string, spec: string, aliases: AliasEntry[]): string | null {
  if (spec.startsWith('.')) {
    return tryResolveFile(path.resolve(path.dirname(fromFile), spec));
  }
  for (const alias of aliases) {
    if (spec === alias.prefix.slice(0, -1) || spec.startsWith(alias.prefix)) {
      const rest = spec.slice(alias.prefix.length);
      return tryResolveFile(path.join(alias.targetBase, rest));
    }
  }
  return null;
}

export interface ScanResult {
  readonly edges: readonly ImportEdge[];
  readonly unresolvedInternal: readonly UnresolvedRef[];
}

/** Full scan: resolved internal edges + unresolved internal refs (fail-closed). */
export function scan(): ScanResult {
  const aliases = loadAliases(path.join(REPO_ROOT, 'tsconfig.json'));
  const files = listSourceFiles(SRC);
  const edges: ImportEdge[] = [];
  const unresolvedInternal: UnresolvedRef[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const ref of extractRefs(source)) {
      const isInternal = ref.spec.startsWith('.') || isInternalAliasSpec(ref.spec, aliases);
      const to = resolveSpec(file, ref.spec, aliases);
      if (to) edges.push({ from: file, to, kind: ref.kind, spec: ref.spec });
      else if (isInternal) unresolvedInternal.push({ from: file, spec: ref.spec, kind: ref.kind });
    }
  }
  return { edges, unresolvedInternal };
}

export function scanEdges(): ImportEdge[] {
  return scan().edges as ImportEdge[];
}

// --------------------------------------------------------------------------
const under = (file: string, root: string): boolean =>
  file === root || file.startsWith(root + path.sep);

export const LAYER_ROOTS = {
  engines: path.join(SRC, 'engines'),
  shared: path.join(SRC, 'shared'),
  app: path.join(SRC, 'app'),
  persistence: path.join(SRC, 'persistence'),
  asset: path.join(SRC, 'persistence', 'asset-store'),
  export: path.join(SRC, 'export'),
  config: path.join(SRC, 'config'),
  schemas: path.join(REPO_ROOT, 'schemas'),
  ui: path.join(SRC, 'ui'),
} as const;

export const UI_FORBIDDEN_LAYERS = [
  LAYER_ROOTS.engines,
  LAYER_ROOTS.shared,
  LAYER_ROOTS.app,
  LAYER_ROOTS.persistence,
  LAYER_ROOTS.export,
  LAYER_ROOTS.config,
];

export type EngineName =
  | 'rule-engine'
  | 'palette-engine'
  | 'print-area-engine'
  | 'dedup-engine'
  | 'scene-engine'
  | 'validation-engine'
  | 'prompt-engine'
  | 'cover-engine'
  | 'export-engine';

export const ALL_ENGINES: readonly EngineName[] = [
  'rule-engine',
  'palette-engine',
  'print-area-engine',
  'dedup-engine',
  'scene-engine',
  'validation-engine',
  'prompt-engine',
  'cover-engine',
  'export-engine',
];

export const ALLOWED_ENGINE_IMPORTS: Readonly<Record<EngineName, readonly EngineName[]>> = {
  'rule-engine': [],
  'palette-engine': [],
  'print-area-engine': [],
  'dedup-engine': [],
  'scene-engine': ['rule-engine', 'palette-engine', 'print-area-engine', 'dedup-engine'],
  'validation-engine': ['rule-engine', 'print-area-engine'],
  'prompt-engine': [],
  'cover-engine': [],
  'export-engine': [],
};

export function engineOf(file: string): EngineName | null {
  for (const e of ALL_ENGINES) {
    if (under(file, path.join(LAYER_ROOTS.engines, e))) return e;
  }
  return null;
}

const rel = (f: string): string => path.relative(SRC, f);

// --------------------------------------------------------------------------
// Pure checks
// --------------------------------------------------------------------------
export function checkNoUiImports(edges: readonly ImportEdge[]): string[] {
  return edges
    .filter((e) => UI_FORBIDDEN_LAYERS.some((r) => under(e.from, r)) && under(e.to, LAYER_ROOTS.ui))
    .map((e) => `${rel(e.from)} --(${e.kind})--> ${rel(e.to)}`)
    .sort();
}

export function checkEngineMatrix(edges: readonly ImportEdge[]): string[] {
  const out: string[] = [];
  for (const e of edges) {
    const fromEngine = engineOf(e.from);
    const toEngine = engineOf(e.to);
    if (!fromEngine || !toEngine || fromEngine === toEngine) continue;
    if (!ALLOWED_ENGINE_IMPORTS[fromEngine].includes(toEngine)) {
      out.push(`${fromEngine} --(${e.kind})--> ${toEngine} (forbidden)`);
    }
  }
  return out.sort();
}

/** Flag edges from `fromRoot` into ANY engine (leaf infrastructure rule). */
export function checkNoEngineImportsFrom(edges: readonly ImportEdge[], fromRoot: string): string[] {
  return edges
    .filter((e) => under(e.from, fromRoot) && engineOf(e.to) !== null && engineOf(e.from) === null)
    .map((e) => `${rel(e.from)} --(${e.kind})--> ${rel(e.to)}`)
    .sort();
}

/** Flag any engine importing the Orchestrator (app). */
export function checkNoEngineImportsApp(edges: readonly ImportEdge[]): string[] {
  return edges
    .filter((e) => engineOf(e.from) !== null && under(e.to, LAYER_ROOTS.app))
    .map((e) => `${rel(e.from)} --(${e.kind})--> ${rel(e.to)}`)
    .sort();
}

/** Flag edges from `fromRoot` to internal targets not under any allowed root (or self). */
export function checkAllowedTargets(
  edges: readonly ImportEdge[],
  fromRoot: string,
  allowedRoots: readonly string[],
): string[] {
  return edges
    .filter((e) => under(e.from, fromRoot))
    .filter((e) => !allowedRoots.some((r) => under(e.to, r)) && !under(e.to, fromRoot))
    .map((e) => `${rel(e.from)} --(${e.kind})--> ${rel(e.to)}`)
    .sort();
}

export function checkAcyclic(edges: readonly ImportEdge[]): string[] {
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    const list = adjacency.get(e.from) ?? [];
    list.push(e.to);
    adjacency.set(e.from, list);
  }
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const cycles: string[] = [];
  const visit = (node: string, stack: readonly string[]): void => {
    color.set(node, GRAY);
    for (const next of (adjacency.get(node) ?? []).slice().sort()) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) cycles.push([...stack, node, next].map(rel).join(' -> '));
      else if (c === WHITE) visit(next, [...stack, node]);
    }
    color.set(node, BLACK);
  };
  for (const node of [...adjacency.keys()].sort()) {
    if ((color.get(node) ?? WHITE) === WHITE) visit(node, []);
  }
  return cycles.sort();
}

export function fixtureEdge(fromRel: string, toRel: string, kind: ImportKind): ImportEdge {
  return {
    from: path.join(SRC, fromRel),
    to: path.join(SRC, toRel),
    kind,
    spec: `fixture:${toRel}`,
  };
}
