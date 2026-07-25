import type { ColorId, ResolvedConstraint } from '../../shared/domain-model';
import { RuleDomain } from '../../shared/domain-model';
import { paletteFailure } from './failures';
import type { PaletteEngineInput, PaletteEngineResult, PaletteEngineSafetyLimits } from './types';

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function hasCycle(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== 'object') return false;
  const object = value as object;
  if (seen.has(object)) return true;
  seen.add(object);
  for (const key of Object.keys(object)) {
    if (DANGEROUS_KEYS.has(key)) return true;
    if (hasCycle((object as Record<string, unknown>)[key], seen)) return true;
  }
  seen.delete(object);
  return false;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function validId(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    !hasControlCharacter(value) &&
    !DANGEROUS_KEYS.has(value)
  );
}

export function validatePaletteInput(
  input: PaletteEngineInput,
  limits: PaletteEngineSafetyLimits,
): PaletteEngineResult | null {
  if (hasCycle(input)) {
    return { ok: false, failures: [paletteFailure('PE_INTERNAL_CYCLE', 'input')] };
  }
  if (!input || typeof input !== 'object' || !input.selection || !input.library) {
    return { ok: false, failures: [paletteFailure('PE_INTERNAL_INPUT', 'input')] };
  }
  if (
    !Array.isArray(input.constraints) ||
    !Array.isArray(input.library.colors) ||
    !Array.isArray(input.library.palettes)
  ) {
    return { ok: false, failures: [paletteFailure('PE_INTERNAL_INPUT', 'input')] };
  }
  const colorIds = input.selection.colorIds;
  if (!Array.isArray(colorIds)) {
    return { ok: false, failures: [paletteFailure('PE_INTERNAL_INPUT', 'selection.colorIds')] };
  }
  if (colorIds.length === 0) {
    return { ok: false, failures: [paletteFailure('RULE_PAL_003', 'selection.colorIds')] };
  }
  if (
    colorIds.length > limits.maxColors ||
    input.library.colors.length > limits.maxColors ||
    input.library.palettes.length > limits.maxPalettes ||
    input.constraints.length > limits.maxConstraints
  ) {
    return { ok: false, failures: [paletteFailure('PE_INTERNAL_LIMIT', 'input')] };
  }
  if (typeof input.selection.locked !== 'boolean') {
    return { ok: false, failures: [paletteFailure('PE_INTERNAL_INPUT', 'selection.locked')] };
  }
  if (colorIds.some((id) => !validId(id, limits.maxIdLength))) {
    return { ok: false, failures: [paletteFailure('PE_INTERNAL_INPUT', 'selection.colorIds')] };
  }
  if (
    !Array.isArray(input.library.colors) ||
    input.library.colors.some(
      (color) =>
        !color ||
        !validId(color.id, limits.maxIdLength) ||
        typeof color.name !== 'string' ||
        typeof color.hex !== 'string',
    )
  ) {
    return { ok: false, failures: [paletteFailure('PE_INTERNAL_LIBRARY', 'library.colors')] };
  }
  const libraryIds = input.library.colors.map((color) => color.id);
  if (new Set(libraryIds).size !== libraryIds.length) {
    return { ok: false, failures: [paletteFailure('PE_INTERNAL_LIBRARY', 'library.colors')] };
  }
  if (
    !Array.isArray(input.library.palettes) ||
    input.library.palettes.some(
      (palette) =>
        !palette ||
        !validId(palette.id, limits.maxIdLength) ||
        typeof palette.name !== 'string' ||
        !Array.isArray(palette.colorIds) ||
        !Array.isArray(palette.lockRules),
    )
  ) {
    return { ok: false, failures: [paletteFailure('PE_INTERNAL_LIBRARY', 'library.palettes')] };
  }
  const paletteIds = input.library.palettes.map((palette) => palette.id);
  if (new Set(paletteIds).size !== paletteIds.length) {
    return { ok: false, failures: [paletteFailure('PE_INTERNAL_LIBRARY', 'library.palettes')] };
  }
  if (input.selection.paletteId !== undefined && !paletteIds.includes(input.selection.paletteId)) {
    return { ok: false, failures: [paletteFailure('PE_INTERNAL_LIBRARY', 'selection.paletteId')] };
  }
  const known = new Set(libraryIds);
  const unknownSelected = colorIds.find((id) => !known.has(id));
  if (unknownSelected) {
    return {
      ok: false,
      failures: [
        paletteFailure('PE_INTERNAL_LIBRARY', 'selection.colorIds', null, unknownSelected),
      ],
    };
  }
  if (input.requestedGarmentColorId !== undefined) {
    if (!validId(input.requestedGarmentColorId, limits.maxIdLength)) {
      return {
        ok: false,
        failures: [paletteFailure('PE_INTERNAL_INPUT', 'requestedGarmentColorId')],
      };
    }
    if (!known.has(input.requestedGarmentColorId)) {
      return {
        ok: false,
        failures: [
          paletteFailure(
            'PE_INTERNAL_LIBRARY',
            'requestedGarmentColorId',
            null,
            input.requestedGarmentColorId,
          ),
        ],
      };
    }
  }
  for (const constraint of input.constraints) {
    const error = validateConstraint(constraint, known, limits.maxIdLength);
    if (error) return { ok: false, failures: [error] };
  }
  return null;
}

function validateConstraint(
  constraint: ResolvedConstraint,
  known: ReadonlySet<ColorId>,
  maxIdLength: number,
) {
  if (!constraint || typeof constraint !== 'object') {
    return paletteFailure('PE_INTERNAL_CONSTRAINT', 'constraints');
  }
  if (constraint.domain !== RuleDomain.Palette && constraint.domain !== RuleDomain.GarmentColor) {
    return null;
  }
  if (!validId(constraint.target, maxIdLength)) {
    return paletteFailure('PE_INTERNAL_CONSTRAINT', 'constraints.target');
  }
  if (constraint.limit !== null) {
    return paletteFailure('PE_INTERNAL_CONSTRAINT', 'constraints.limit');
  }
  if (constraint.lockedTo !== null) {
    if (!Array.isArray(constraint.lockedTo) || constraint.lockedTo.length === 0) {
      return paletteFailure('PE_INTERNAL_CONSTRAINT', 'constraints.lockedTo');
    }
    const unknown = constraint.lockedTo.find(
      (value) => !validId(value, maxIdLength) || !known.has(value as ColorId),
    );
    if (unknown) return paletteFailure('PE_INTERNAL_CONSTRAINT', 'constraints.lockedTo');
  }
  if (!Array.isArray(constraint.winningRuleIds)) {
    return paletteFailure('PE_INTERNAL_CONSTRAINT', 'constraints.winningRuleIds');
  }
  return null;
}
