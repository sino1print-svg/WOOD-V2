import {
  EngineId,
  RuleDomain,
  ValidationCheck,
  type ValidationFailure,
} from '../../shared/domain-model';
import { ERROR_BY_CODE } from '../../shared/errors';
import type { ExportPlanningFailureCode } from './types';

function defaultCheck(domain: RuleDomain | null): ValidationCheck {
  if (domain === RuleDomain.Cover) return ValidationCheck.CoverData;
  if (domain === RuleDomain.Output || domain === RuleDomain.Artwork) {
    return ValidationCheck.Products;
  }
  if (domain === RuleDomain.Prompt) return ValidationCheck.Products;
  return ValidationCheck.SceneCount;
}

/** Build Export failures exclusively from the authoritative EX §19 registry. */
export function exportFailure(
  requestedCode: ExportPlanningFailureCode,
  field: string,
): ValidationFailure {
  const fallback = ERROR_BY_CODE.EXPORT_CORRUPT_001!;
  const candidate = ERROR_BY_CODE[requestedCode];
  const entry =
    candidate?.namespace === 'EXPORT' && candidate.originEngine === EngineId.Export
      ? candidate
      : fallback;
  return Object.freeze({
    check: entry.check ?? defaultCheck(entry.domain),
    field,
    code: entry.code,
    message: entry.messageAr,
    severity: entry.severity,
    ruleId: null,
    priorityClass: entry.priorityClass,
    domain: entry.domain,
    originEngine: EngineId.Export,
  });
}
