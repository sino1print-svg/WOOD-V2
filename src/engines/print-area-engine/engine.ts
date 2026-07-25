import type { PrintAreaObstruction } from '../../shared/domain-model';
import type { PrintAreaEngineInput, PrintAreaEngineResult } from './types';
import { printAreaFailure } from './failures';
import { validatePrintAreaInput } from './validation';

function canonicalOverlaps(
  values: readonly PrintAreaObstruction[],
): readonly PrintAreaObstruction[] {
  return [...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/**
 * Pure Print-Area measurement adapter.
 * It normalizes caller-supplied planned/rendered measurement facts. Numeric profile
 * predicates remain Validation-Engine-owned (RE §7); raw rules are never consumed here.
 */
export function measurePrintArea(input: PrintAreaEngineInput): PrintAreaEngineResult {
  try {
    const invalid = validatePrintAreaInput(input);
    if (invalid) return invalid;

    const diagnostics: import('./types').PrintAreaDiagnostic[] = [
      {
        code: 'measurement.normalized' as const,
        messageAr: 'تم تطبيع حقائق قياس منطقة الطباعة بترتيب حتمي.',
        messageEn: 'Print-area measurement facts were normalized deterministically.',
      },
    ];
    if ((input.constraints?.length ?? 0) > 0) {
      diagnostics.push({
        code: 'constraints.ignored' as const,
        messageAr: 'لا يعيد محرك منطقة الطباعة تقييم قيود محرك القواعد.',
        messageEn: 'The Print-Area Engine does not re-evaluate Rule Engine constraints.',
      });
    }

    return {
      ok: true,
      value: {
        productId: input.product.id,
        profileId: input.profile.id,
        position: input.profile.position,
        measurement: {
          overlaps: canonicalOverlaps(input.observation.overlaps),
          sizeRatio: input.observation.sizeRatio,
          centeringOffset: input.observation.centeringOffset,
          shadowCoverage: input.observation.shadowCoverage,
        },
        diagnostics,
      },
    };
  } catch {
    return { ok: false, failures: [printAreaFailure('PA_INTERNAL_INPUT', 'input')] };
  }
}
