/**
 * Architecture-boundary validation (deterministic).
 * Enforces the COMPLETE permission matrix of 10_APP_WORKFLOW §2.3–§2.4 and
 * 12_IMPLEMENTATION_GUIDE §8, including Persistence + Asset leaf rules and the
 * "no engine imports Orchestrator" rule. Unresolved internal aliases FAIL CLOSED.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  ALLOWED_ENGINE_IMPORTS,
  LAYER_ROOTS,
  checkAcyclic,
  checkAllowedTargets,
  checkEngineMatrix,
  checkNoEngineImportsApp,
  checkNoEngineImportsFrom,
  checkNoUiImports,
  fixtureEdge,
  scan,
  type EngineName,
  type ImportKind,
} from './scan';

const { edges, unresolvedInternal } = scan();
const EXPORT_ENGINE_ROOT = path.join(LAYER_ROOTS.engines, 'export-engine');

describe('architecture boundaries — real source (zero violations)', () => {
  it('scans a non-empty set of edges', () => {
    expect(edges.length).toBeGreaterThan(10);
  });
  it('no unresolved internal aliases/relatives (fails closed)', () => {
    expect(unresolvedInternal).toEqual([]);
  });
  it('no forbidden UI imports', () => {
    expect(checkNoUiImports(edges)).toEqual([]);
  });
  it('engine-to-engine imports satisfy the matrix', () => {
    expect(checkEngineMatrix(edges)).toEqual([]);
  });
  it('no engine imports the Orchestrator (app)', () => {
    expect(checkNoEngineImportsApp(edges)).toEqual([]);
  });
  it('Persistence imports no engine', () => {
    expect(checkNoEngineImportsFrom(edges, LAYER_ROOTS.persistence)).toEqual([]);
  });
  it('Asset Store imports no engine', () => {
    expect(checkNoEngineImportsFrom(edges, LAYER_ROOTS.asset)).toEqual([]);
  });
  it('Export imports no engine (no mutating engine)', () => {
    expect(checkNoEngineImportsFrom(edges, LAYER_ROOTS.export)).toEqual([]);
  });
  it('Config imports no engine', () => {
    expect(checkNoEngineImportsFrom(edges, LAYER_ROOTS.config)).toEqual([]);
  });
  it('Rule Engine imports only shared + config (+ self), never persistence/assets/UI/app', () => {
    expect(
      checkAllowedTargets(edges, path.join(LAYER_ROOTS.engines, 'rule-engine'), [
        LAYER_ROOTS.shared,
        LAYER_ROOTS.config,
      ]),
    ).toEqual([]);
  });
  it('Export Engine imports only shared + config + export infrastructure (+ self)', () => {
    expect(
      checkAllowedTargets(edges, EXPORT_ENGINE_ROOT, [
        LAYER_ROOTS.shared,
        LAYER_ROOTS.config,
        LAYER_ROOTS.export,
      ]),
    ).toEqual([]);
  });
  it('Persistence may import only shared + config + authoritative schemas (+ self)', () => {
    expect(
      checkAllowedTargets(edges, LAYER_ROOTS.persistence, [
        LAYER_ROOTS.shared,
        LAYER_ROOTS.config,
        LAYER_ROOTS.schemas,
      ]),
    ).toEqual([]);
  });
  it('Asset may import only shared + config (+ persistence infra)', () => {
    expect(
      checkAllowedTargets(edges, LAYER_ROOTS.asset, [
        LAYER_ROOTS.shared,
        LAYER_ROOTS.config,
        LAYER_ROOTS.persistence,
      ]),
    ).toEqual([]);
  });
  it('Export may import only shared + config (+ self)', () => {
    expect(
      checkAllowedTargets(edges, LAYER_ROOTS.export, [LAYER_ROOTS.shared, LAYER_ROOTS.config]),
    ).toEqual([]);
  });
  it('Config may import only shared (+ self)', () => {
    expect(checkAllowedTargets(edges, LAYER_ROOTS.config, [LAYER_ROOTS.shared])).toEqual([]);
  });
  it('the graph is acyclic', () => {
    expect(checkAcyclic(edges)).toEqual([]);
  });
});

describe('architecture boundaries — matrix declarations', () => {
  const leaves: EngineName[] = [
    'rule-engine',
    'palette-engine',
    'print-area-engine',
    'dedup-engine',
  ];
  for (const leaf of leaves) {
    it(`${leaf} allows no engine imports`, () => expect(ALLOWED_ENGINE_IMPORTS[leaf]).toEqual([]));
  }
  for (const terminal of ['prompt-engine', 'cover-engine', 'export-engine'] as EngineName[]) {
    it(`${terminal} allows no engine imports`, () =>
      expect(ALLOWED_ENGINE_IMPORTS[terminal]).toEqual([]));
  }
  it('Scene allows only rule/palette/print-area/dedup', () => {
    expect([...ALLOWED_ENGINE_IMPORTS['scene-engine']].sort()).toEqual(
      ['dedup-engine', 'palette-engine', 'print-area-engine', 'rule-engine'].sort(),
    );
  });
  it('Validation allows only rule/print-area', () => {
    expect([...ALLOWED_ENGINE_IMPORTS['validation-engine']].sort()).toEqual(
      ['print-area-engine', 'rule-engine'].sort(),
    );
  });
});

describe('architecture boundaries — synthetic fixtures FAIL CLOSED', () => {
  const kinds: ImportKind[] = ['static', 'reexport', 'sideEffect', 'dynamic', 'require'];

  it('Persistence -> Rule Engine is flagged', () => {
    const e = [
      fixtureEdge('persistence/project-store/index.ts', 'engines/rule-engine/index.ts', 'static'),
    ];
    expect(checkNoEngineImportsFrom(e, LAYER_ROOTS.persistence).length).toBe(1);
  });
  it('Asset Store -> Scene Engine is flagged', () => {
    const e = [
      fixtureEdge('persistence/asset-store/index.ts', 'engines/scene-engine/index.ts', 'static'),
    ];
    expect(checkNoEngineImportsFrom(e, LAYER_ROOTS.asset).length).toBe(1);
  });
  it('Prompt -> Rule, Cover -> Prompt, Validation -> Scene, Scene -> Prompt are flagged', () => {
    const e = [
      fixtureEdge('engines/prompt-engine/index.ts', 'engines/rule-engine/index.ts', 'static'),
      fixtureEdge('engines/cover-engine/index.ts', 'engines/prompt-engine/index.ts', 'static'),
      fixtureEdge('engines/validation-engine/index.ts', 'engines/scene-engine/index.ts', 'static'),
      fixtureEdge('engines/scene-engine/index.ts', 'engines/prompt-engine/index.ts', 'static'),
    ];
    expect(checkEngineMatrix(e).length).toBe(4);
  });
  it('engine -> UI via alias (resolved to ui/) is flagged', () => {
    // @ui/app-shell/AppShell resolves to ui/app-shell/AppShell.tsx (see scan.test.ts).
    const e = [fixtureEdge('engines/rule-engine/index.ts', 'ui/app-shell/AppShell.tsx', 'static')];
    expect(checkNoUiImports(e).length).toBe(1);
  });
  it('engine -> UI via barrel re-export is flagged', () => {
    const e = [fixtureEdge('engines/cover-engine/index.ts', 'ui/components/index.ts', 'reexport')];
    expect(checkNoUiImports(e).length).toBe(1);
  });
  it('engine -> forbidden engine via dynamic import is flagged', () => {
    const e = [
      fixtureEdge('engines/prompt-engine/index.ts', 'engines/scene-engine/index.ts', 'dynamic'),
    ];
    expect(checkEngineMatrix(e).length).toBe(1);
  });
  it('engine -> forbidden engine via require() is flagged', () => {
    const e = [
      fixtureEdge('engines/export-engine/index.ts', 'engines/scene-engine/index.ts', 'require'),
    ];
    expect(checkEngineMatrix(e).length).toBe(1);
  });
  it('Export Engine -> Persistence is flagged for every import form', () => {
    for (const kind of kinds) {
      const e = [
        fixtureEdge('engines/export-engine/index.ts', 'persistence/project-store/index.ts', kind),
      ];
      expect(
        checkAllowedTargets(e, EXPORT_ENGINE_ROOT, [
          LAYER_ROOTS.shared,
          LAYER_ROOTS.config,
          LAYER_ROOTS.export,
        ]).length,
      ).toBe(1);
    }
  });
  it('Export Engine -> UI is flagged by its explicit allowlist', () => {
    const e = [
      fixtureEdge('engines/export-engine/index.ts', 'ui/app-shell/AppShell.tsx', 'static'),
    ];
    expect(
      checkAllowedTargets(e, EXPORT_ENGINE_ROOT, [
        LAYER_ROOTS.shared,
        LAYER_ROOTS.config,
        LAYER_ROOTS.export,
      ]).length,
    ).toBe(1);
  });
  it('Export Engine -> export infrastructure remains allowed', () => {
    const e = [fixtureEdge('engines/export-engine/index.ts', 'export/index.ts', 'static')];
    expect(
      checkAllowedTargets(e, EXPORT_ENGINE_ROOT, [
        LAYER_ROOTS.shared,
        LAYER_ROOTS.config,
        LAYER_ROOTS.export,
      ]),
    ).toEqual([]);
  });
  it('engine -> Orchestrator (app) is flagged (all forms)', () => {
    for (const kind of kinds) {
      const e = [fixtureEdge('engines/scene-engine/index.ts', 'app/orchestrator/index.ts', kind)];
      expect(checkNoEngineImportsApp(e).length).toBe(1);
    }
  });
  it('engine -> UI is flagged for every import form', () => {
    for (const kind of kinds) {
      const e = [fixtureEdge('engines/rule-engine/index.ts', 'ui/app-shell/AppShell.tsx', kind)];
      expect(checkNoUiImports(e).length).toBe(1);
    }
  });
  it('Persistence -> Export (disallowed target) is flagged by allowed-targets', () => {
    const e = [fixtureEdge('persistence/project-store/index.ts', 'export/index.ts', 'static')];
    expect(
      checkAllowedTargets(e, LAYER_ROOTS.persistence, [LAYER_ROOTS.shared, LAYER_ROOTS.config])
        .length,
    ).toBe(1);
  });
  it('detects a synthetic cycle', () => {
    const cyclic = [fixtureEdge('a.ts', 'b.ts', 'static'), fixtureEdge('b.ts', 'a.ts', 'static')];
    expect(checkAcyclic(cyclic).length).toBeGreaterThan(0);
  });
});
