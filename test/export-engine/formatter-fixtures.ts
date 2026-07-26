import { APP_CONFIG } from '../../src/config/app-config';
import { createExportPlan } from '../../src/engines/export-engine';
import type { ExportEngineInput, ExportOperationalScope } from '../../src/shared/contracts';
import type { Project } from '../../src/shared/domain-model';
import type { ExportFormatterInput } from '../../src/export';
import {
  CANONICAL_EXPORT_INPUT,
  CANONICAL_PROJECT,
  CANONICAL_SCENE_ID,
  CANONICAL_SESSION_ID,
  createCanonicalMultiSceneExportInput,
} from './fixtures';

export interface FormatterFixtureOptions {
  readonly promptA?: string;
  readonly promptB?: string;
  readonly groupPrompt?: string | null;
  readonly coverPrompt?: string;
  readonly scope?: ExportOperationalScope;
  readonly omitOutputB?: boolean;
  readonly omitCover?: boolean;
  readonly ownerRef?: string;
}

export function formatterInputFromEngine(input: ExportEngineInput): ExportFormatterInput {
  return {
    planResult: createExportPlan(input),
    limits: input.limits,
  };
}

export function createFormatterFixture(
  options: FormatterFixtureOptions = {},
): ExportFormatterInput {
  const project: Project = structuredClone(CANONICAL_PROJECT);
  const session = project.sessions[CANONICAL_SESSION_ID];
  const scene = session?.scenes[CANONICAL_SCENE_ID];
  if (!session || !scene) {
    return {
      planResult: createExportPlan(CANONICAL_EXPORT_INPUT),
      limits: APP_CONFIG.limits.export,
    };
  }

  if (options.promptA !== undefined) scene.outputA.promptText = options.promptA;
  if (options.omitOutputB) scene.outputB = null;
  else if (options.promptB !== undefined && scene.outputB)
    scene.outputB.promptText = options.promptB;
  const group = Object.values(session.groups)[0];
  if (group && options.groupPrompt !== undefined) group.groupPromptText = options.groupPrompt;
  if (options.omitCover) session.cover = null;
  else if (session.cover && options.coverPrompt !== undefined) {
    session.cover.promptText = options.coverPrompt;
  }
  if (options.ownerRef !== undefined) project.ownerRef = options.ownerRef;

  const input: ExportEngineInput = {
    ...CANONICAL_EXPORT_INPUT,
    source: {
      ...CANONICAL_EXPORT_INPUT.source,
      project,
    },
    scope: options.scope ?? CANONICAL_EXPORT_INPUT.scope,
  };
  return formatterInputFromEngine(input);
}

export function createMultiSceneFormatterFixture(): ExportFormatterInput {
  return formatterInputFromEngine(createCanonicalMultiSceneExportInput());
}

export function cloneFormatterInput(input: ExportFormatterInput): ExportFormatterInput {
  return structuredClone(input);
}
