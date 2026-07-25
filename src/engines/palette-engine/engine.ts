import { APP_CONFIG } from '../../config/app-config';
import { RuleDomain, type ColorId, type ResolvedConstraint } from '../../shared/domain-model';
import { paletteFailure, paletteMessages } from './failures';
import {
  canonicalColorIds,
  containsColor,
  excludeColorIds,
  intersectColorIds,
} from './set-operations';
import type {
  GarmentColorStageResult,
  PaletteDiagnostic,
  PaletteEngineInput,
  PaletteEngineResult,
  PaletteEngineSafetyLimits,
  PaletteStageResult,
  ResolvedPalette,
} from './types';
import { validatePaletteInput } from './validation';

/**
 * Public two-stage Palette Engine adapter.
 * Stage 1 resolves selection-level palette constraints only.
 * Stage 2 consumes the immutable resolved palette and evaluates only
 * GarmentColor constraints for the requested color.
 */
export function resolvePalette(
  input: PaletteEngineInput,
  limits: PaletteEngineSafetyLimits = APP_CONFIG.limits.paletteEngine,
): PaletteEngineResult {
  const invalid = validatePaletteInput(input, limits);
  if (invalid) return invalid;

  const paletteStage = resolvePaletteStage(input);
  if (!paletteStage.ok) return paletteStage;

  const garmentStage = validateGarmentColorStage(
    paletteStage.value,
    input.requestedGarmentColorId,
    input.constraints,
    input.selection.locked,
  );
  if (!garmentStage.ok) return garmentStage;

  return {
    ok: true,
    value: {
      ...paletteStage.value,
      garmentColorAllowed: garmentStage.value.allowed,
      diagnostics: canonicalDiagnostics([
        ...paletteStage.value.diagnostics,
        ...garmentStage.value.diagnostics,
      ]),
    },
  };
}

/** Selection-level resolution. GarmentColor constraints are intentionally ignored. */
export function resolvePaletteStage(input: PaletteEngineInput): PaletteStageResult {
  let allowed = canonicalColorIds(input.selection.colorIds);
  const diagnostics: PaletteDiagnostic[] = [];
  const constraints = canonicalConstraints(
    input.constraints.filter((item) => item.domain === RuleDomain.Palette),
  );

  for (const constraint of constraints) {
    if (constraint.lockedTo !== null) {
      allowed = intersectColorIds(allowed, constraint.lockedTo as readonly ColorId[]);
      diagnostics.push(diagnostic('palette.lock', constraint));
    }
    if (constraint.forbidden) {
      allowed = excludeColorIds(allowed, [constraint.target as ColorId]);
      diagnostics.push(diagnostic('palette.forbid', constraint));
    }
    if (constraint.required && !containsColor(allowed, constraint.target as ColorId)) {
      return {
        ok: false,
        failures: [
          paletteFailure(
            'RULE_PAL_001',
            'constraints.required',
            constraint.winningRuleIds[0] ?? null,
          ),
        ],
      };
    }
    if (allowed.length === 0) {
      return {
        ok: false,
        failures: [
          paletteFailure('RULE_PAL_003', 'resolved.colorIds', constraint.winningRuleIds[0] ?? null),
        ],
      };
    }
  }

  return {
    ok: true,
    value: {
      colorIds: allowed,
      locked: input.selection.locked,
      paletteId: input.selection.paletteId ?? null,
      diagnostics: canonicalDiagnostics(diagnostics),
    },
  };
}

/**
 * Per-scene garment-color validation. This function has no write path back to
 * ResolvedPalette: it reads the palette and returns an independent membership result.
 */
export function validateGarmentColorStage(
  palette: Readonly<ResolvedPalette>,
  requested: ColorId | undefined,
  constraints: readonly ResolvedConstraint[],
  selectionLocked: boolean,
): GarmentColorStageResult {
  if (requested === undefined) {
    return { ok: true, value: { allowed: null, diagnostics: [] } };
  }

  const paletteMembership = containsColor(palette.colorIds, requested);
  if (!paletteMembership) {
    if (selectionLocked) {
      return {
        ok: false,
        failures: [paletteFailure('RULE_PAL_001', 'requestedGarmentColorId')],
      };
    }
    return { ok: true, value: { allowed: false, diagnostics: [] } };
  }

  let allowed = true;
  const diagnostics: PaletteDiagnostic[] = [];
  const garmentConstraints = canonicalConstraints(
    constraints.filter((item) => item.domain === RuleDomain.GarmentColor),
  );

  for (const constraint of garmentConstraints) {
    if (constraint.lockedTo !== null) {
      allowed = allowed && containsColor(constraint.lockedTo as readonly ColorId[], requested);
      diagnostics.push(diagnostic('garment_color.lock', constraint));
    }
    if (constraint.forbidden && constraint.target === requested) {
      allowed = false;
      diagnostics.push(diagnostic('garment_color.forbid', constraint));
    }
    if (constraint.required) {
      allowed = allowed && constraint.target === requested;
      diagnostics.push(diagnostic('garment_color.require', constraint));
    }
  }

  return {
    ok: true,
    value: { allowed, diagnostics: canonicalDiagnostics(diagnostics) },
  };
}

function diagnostic(code: string, constraint: ResolvedConstraint): PaletteDiagnostic {
  const messages = paletteMessages(
    constraint.forbidden ? 'RULE_PAL_002' : constraint.lockedTo ? 'RULE_PAL_001' : 'RULE_PAL_003',
  );
  return {
    code,
    messageAr: messages.ar,
    messageEn: messages.en,
    ruleIds: [...constraint.winningRuleIds].sort(),
    domain: constraint.domain === RuleDomain.Palette ? 'palette' : 'garment_color',
  };
}

function canonicalConstraints(
  constraints: readonly ResolvedConstraint[],
): readonly ResolvedConstraint[] {
  return [...constraints].sort(compareConstraint);
}

function canonicalDiagnostics(
  diagnostics: readonly PaletteDiagnostic[],
): readonly PaletteDiagnostic[] {
  return [...diagnostics].sort((left, right) => {
    const leftKey = `${left.domain}\u0000${left.code}\u0000${left.ruleIds.join(',')}`;
    const rightKey = `${right.domain}\u0000${right.code}\u0000${right.ruleIds.join(',')}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function compareConstraint(left: ResolvedConstraint, right: ResolvedConstraint): number {
  const leftKey = `${left.domain}\u0000${left.target}\u0000${left.bucketKey}\u0000${left.winningRuleIds.join(',')}`;
  const rightKey = `${right.domain}\u0000${right.target}\u0000${right.bucketKey}\u0000${right.winningRuleIds.join(',')}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}
