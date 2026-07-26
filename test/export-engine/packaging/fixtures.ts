import { PromptModuleType, type SemVer } from '../../../src/shared/domain-model';
import type { ExportPackageInput } from '../../../src/export/packaging';
import type { ExportFormatterInput } from '../../../src/export';
import { CANONICAL_RULE_SET_ID } from '../fixtures';
import {
  createFormatterFixture,
  createMultiSceneFormatterFixture,
  type FormatterFixtureOptions,
} from '../formatter-fixtures';

export const CANONICAL_CREATED_AT = '2026-07-26T10:00:00.000Z';
export const CANONICAL_EXPORT_ID = 'export-canonical-batch10.4';

const version = (value: string): SemVer => value as SemVer;

export const CANONICAL_VERSIONS: ExportPackageInput['versions'] = {
  applicationVersion: version('0.1.0'),
  generatorVersion: version('0.1.0'),
  ruleSetVersions: { [CANONICAL_RULE_SET_ID]: 3 },
  promptModuleVersions: {
    [PromptModuleType.Global]: version('1.0.0'),
    [PromptModuleType.Product]: version('1.0.0'),
    [PromptModuleType.Season]: version('1.0.0'),
    [PromptModuleType.Scene]: version('1.0.0'),
    [PromptModuleType.OutputA]: version('1.0.0'),
    [PromptModuleType.OutputB]: version('1.0.0'),
    [PromptModuleType.Cover]: version('1.0.0'),
    [PromptModuleType.Group]: version('1.0.0'),
  },
};

export function packageInputFromFormatter(
  formatterInput: ExportFormatterInput,
): ExportPackageInput {
  return {
    planResult: formatterInput.planResult,
    limits: formatterInput.limits,
    versions: CANONICAL_VERSIONS,
    createdAt: CANONICAL_CREATED_AT,
    exportId: CANONICAL_EXPORT_ID,
  };
}

export function createPackageFixture(options: FormatterFixtureOptions = {}): ExportPackageInput {
  return packageInputFromFormatter(createFormatterFixture(options));
}

export function createMultiScenePackageFixture(): ExportPackageInput {
  return packageInputFromFormatter(createMultiSceneFormatterFixture());
}

export function clonePackageInput(input: ExportPackageInput): ExportPackageInput {
  return structuredClone(input);
}
