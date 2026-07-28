import { ExportScope, type ValidationFailure } from '../../shared/domain-model';
import type { ExportEngineInput } from '../../shared/contracts/export-contracts';
import { exportFailure } from './failures';
import { buildExportNumbering } from './ordering';
import { freezeDeep } from './runtime';
import { resolveExportScope } from './scope';
import { computeExportProvenance, selectExportArtifacts } from './selection';
import type { ExportAllowlistedSelection, ExportPlanResult } from './types';
import {
  evaluateExportEligibility,
  validateExportPlanningInput,
  validateSelectedDomainEnums,
  validateSelectedLibraryShapes,
} from './validation';

const FAIL_CLOSED_CODES = new Set([
  'EXPORT_CORRUPT_001',
  'EXPORT_SCHEMA_001',
  'EXPORT_CHECKSUM_001',
  'EXPORT_NUM_001',
]);

function failed(failures: readonly ValidationFailure[]): ExportPlanResult {
  return freezeDeep({ ok: false, failures: [...failures] });
}

function hasDeliverableSelection(
  scopeDetail: ExportEngineInput['scope']['scopeDetail'],
  selection: ExportAllowlistedSelection,
): boolean {
  if (scopeDetail === 'output_a') return selection.outputsA.length === 1;
  if (scopeDetail === 'output_b') return selection.outputsB.length === 1;
  if (scopeDetail === 'pair') return selection.outputsA.length === 1;
  if (scopeDetail === 'group_a') return selection.outputsA.length > 0;
  if (scopeDetail === 'group_b') return selection.outputsB.length > 0;
  if (scopeDetail === 'group') {
    return selection.outputsA.length > 0 || selection.outputsB.length > 0;
  }
  if (scopeDetail === 'cover') return selection.covers.length === 1;
  if (scopeDetail === 'execution_plan') return selection.executionPlans.length === 1;
  if (scopeDetail === 'session') return selection.sessions.length === 1;
  if (scopeDetail === 'complete_project' || scopeDetail === 'all') {
    return selection.project !== null && selection.sessions.length > 0;
  }
  if (scopeDetail === 'version_snapshot') return selection.versions.length === 1;
  if (scopeDetail === 'backup') {
    return selection.project !== null || selection.versions.length === 1;
  }
  return (
    scopeDetail === 'prompt_pack' &&
    selection.outputsA.length > 0 &&
    selection.executionPlans.length > 0
  );
}

/**
 * Pure Batch 10.2 entry point. It returns an immutable export plan containing
 * scope resolution, eligibility, ordering, numbering, and allowlisted source
 * projections. No formatter, bytes, ZIP, delivery, backup, or restore behavior
 * is reachable from this function.
 */
export function createExportPlan(input: ExportEngineInput): ExportPlanResult {
  try {
    const boundaryFailures = validateExportPlanningInput(input);
    if (boundaryFailures.length > 0) return failed(boundaryFailures);
    if (
      !validateSelectedLibraryShapes(input.source) ||
      !validateSelectedDomainEnums(input.source)
    ) {
      return failed([exportFailure('EXPORT_CORRUPT_001', 'input.source')]);
    }

    const resolution = resolveExportScope(input.source, input.scope);
    if (!resolution.ok) return failed(resolution.failures);

    const { numbering, groupNumbering } = buildExportNumbering(
      input.source.project,
      resolution.value,
    );
    const eligibility = evaluateExportEligibility(input.source, resolution.value, input.limits);
    const failClosedIssues = eligibility.issues.filter((issue) =>
      FAIL_CLOSED_CODES.has(issue.code),
    );
    if (failClosedIssues.length > 0) return failed(failClosedIssues);
    const selection = selectExportArtifacts(input.source, resolution.value, numbering, eligibility);
    const eligibleGroupNumbering = groupNumbering.filter((entry) =>
      eligibility.validGroupIds.has(entry.groupId),
    );

    if (eligibility.restrictedGroupBlocked && resolution.value.baseScope === ExportScope.Group) {
      return failed(
        eligibility.issues.length > 0
          ? eligibility.issues
          : [exportFailure('EXPORT_GROUP_001', 'scope.groupId')],
      );
    }
    if (!hasDeliverableSelection(input.scope.scopeDetail, selection)) {
      return failed(
        eligibility.issues.length > 0
          ? eligibility.issues
          : [exportFailure('EXPORT_SCOPE_002', 'scope')],
      );
    }

    return freezeDeep({
      ok: true,
      value: {
        scope: resolution.value,
        numbering,
        groupNumbering: eligibleGroupNumbering,
        selection,
        provenance: computeExportProvenance(input.source, resolution.value),
        omissions: eligibility.omissions,
        issues: eligibility.issues,
        partial: eligibility.omissions.length > 0,
      },
    });
  } catch {
    return failed([exportFailure('EXPORT_CORRUPT_001', 'input')]);
  }
}
