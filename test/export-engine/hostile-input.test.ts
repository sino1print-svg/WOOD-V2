import { describe, expect, it } from 'vitest';
import { createExportPlan } from '../../src/engines/export-engine';
import { ExportFormat, ExportScope, type Project } from '../../src/shared/domain-model';
import type { ExportEngineInput, ExportSourceSnapshot } from '../../src/shared/contracts';
import {
  CANONICAL_EXPORT_INPUT,
  CANONICAL_PROJECT,
  CANONICAL_SCENE_ID,
  CANONICAL_SESSION_ID,
} from './fixtures';

function projectInput(project: Project): ExportEngineInput {
  return {
    ...CANONICAL_EXPORT_INPUT,
    source: { ...CANONICAL_EXPORT_INPUT.source, project },
  };
}

function expectFailure(
  input: ExportEngineInput,
  code: string,
): ReturnType<typeof createExportPlan> {
  let result: ReturnType<typeof createExportPlan> | undefined;
  expect(() => {
    result = createExportPlan(input);
  }).not.toThrow();
  expect(result?.ok).toBe(false);
  if (result?.ok === false) {
    expect(result.failures.map((failure) => failure.code)).toContain(code);
  }
  return result!;
}

describe('Export planner hostile-input protection and fail-closed behavior', () => {
  it('rejects a cyclic source graph without throwing', () => {
    const project = structuredClone(CANONICAL_PROJECT);
    (project as unknown as { injectedCycle: unknown }).injectedCycle = project;
    expectFailure(projectInput(project), 'EXPORT_CORRUPT_001');
  });

  it('rejects accessor properties before scope traversal', () => {
    const project = structuredClone(CANONICAL_PROJECT);
    Object.defineProperty(project, 'name', {
      enumerable: true,
      configurable: true,
      get: () => 'accessor-controlled-name',
    });
    expectFailure(projectInput(project), 'EXPORT_CORRUPT_001');
  });

  it('rejects a proxy whose reflective operations throw', () => {
    const hostileSource = new Proxy(CANONICAL_EXPORT_INPUT.source, {
      getPrototypeOf: () => {
        throw new Error('blocked reflection');
      },
    }) as ExportSourceSnapshot;
    expectFailure({ ...CANONICAL_EXPORT_INPUT, source: hostileSource }, 'EXPORT_CORRUPT_001');
  });

  it('rejects sparse arrays', () => {
    const formats = new Array(2);
    formats[0] = ExportFormat.Txt;
    expectFailure(
      {
        ...CANONICAL_EXPORT_INPUT,
        formats: formats as unknown as ExportEngineInput['formats'],
      },
      'EXPORT_CORRUPT_001',
    );
  });

  it('rejects non-plain object prototypes', () => {
    const source = Object.assign(
      Object.create({ inherited: true }) as Record<string, unknown>,
      CANONICAL_EXPORT_INPUT.source,
    ) as ExportSourceSnapshot;
    expectFailure({ ...CANONICAL_EXPORT_INPUT, source }, 'EXPORT_CORRUPT_001');
  });

  it('rejects dangerous record keys without polluting global prototypes', () => {
    const project = structuredClone(CANONICAL_PROJECT);
    Object.defineProperty(project.sessions, 'constructor', {
      enumerable: true,
      configurable: true,
      value: project.sessions[CANONICAL_SESSION_ID],
    });
    expectFailure(projectInput(project), 'EXPORT_CORRUPT_001');
    expect(({} as { exportPolluted?: boolean }).exportPolluted).toBeUndefined();
  });

  it('rejects excessive graph depth before reading semantic fields', () => {
    const project = structuredClone(CANONICAL_PROJECT);
    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let depth = 0; depth < 80; depth += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    (project as unknown as { excessiveDepth: unknown }).excessiveDepth = root;
    expectFailure(projectInput(project), 'EXPORT_CORRUPT_001');
  });

  it('rejects duplicate or mismatched session ordering with EXPORT_NUM_001', () => {
    const project = structuredClone(CANONICAL_PROJECT);
    project.sessionOrder = [CANONICAL_SESSION_ID, CANONICAL_SESSION_ID];
    expectFailure(projectInput(project), 'EXPORT_NUM_001');
  });

  it('rejects scene-order/map mismatch with EXPORT_NUM_001', () => {
    const project = structuredClone(CANONICAL_PROJECT);
    project.sessions[CANONICAL_SESSION_ID]!.sceneOrder = [];
    project.sessions[CANONICAL_SESSION_ID]!.requestedSceneCount = 0;
    expectFailure(projectInput(project), 'EXPORT_NUM_001');
  });

  it('rejects unsupported project schema versions with EXPORT_SCHEMA_001', () => {
    const project = structuredClone(CANONICAL_PROJECT);
    (project as { schemaVersion: number }).schemaVersion = 2;
    expectFailure(projectInput(project), 'EXPORT_SCHEMA_001');
  });

  it('rejects mismatched scope discriminants and unexpected scope fields', () => {
    const mismatched = {
      baseScope: ExportScope.All,
      scopeDetail: 'output_a',
      sessionId: CANONICAL_SESSION_ID,
      sceneId: CANONICAL_SCENE_ID,
      outputAId:
        CANONICAL_PROJECT.sessions[CANONICAL_SESSION_ID]!.scenes[CANONICAL_SCENE_ID]!.outputA.id,
    } as unknown as ExportEngineInput['scope'];
    const extraField = {
      ...CANONICAL_EXPORT_INPUT.scope,
      unexpected: 'not-allowed',
    } as unknown as ExportEngineInput['scope'];

    expectFailure({ ...CANONICAL_EXPORT_INPUT, scope: mismatched }, 'EXPORT_SCOPE_001');
    expectFailure({ ...CANONICAL_EXPORT_INPUT, scope: extraField }, 'EXPORT_SCOPE_001');
  });

  it('rejects unsupported or duplicate formats', () => {
    expectFailure(
      {
        ...CANONICAL_EXPORT_INPUT,
        formats: ['pdf'] as unknown as ExportEngineInput['formats'],
      },
      'EXPORT_SCOPE_001',
    );
    expectFailure(
      {
        ...CANONICAL_EXPORT_INPUT,
        formats: [ExportFormat.Txt, ExportFormat.Txt],
      },
      'EXPORT_SCOPE_001',
    );
  });

  it('rejects malformed hashes instead of emitting an untrusted selection', () => {
    const project = structuredClone(CANONICAL_PROJECT);
    const scene = project.sessions[CANONICAL_SESSION_ID]!.scenes[CANONICAL_SCENE_ID]!;
    scene.outputA = {
      ...scene.outputA,
      promptHash: 'not-a-sha256' as typeof scene.outputA.promptHash,
    };
    expectFailure(projectInput(project), 'EXPORT_CORRUPT_001');
  });
});
