/**
 * Fail-closed input validation. Rejects malformed shapes, non-finite/out-of-range
 * numbers, and empty required collections before any planning work begins.
 */
import type { ValidationFailure } from '../../shared/domain-model';
import { sceneFailureFromCode } from './failures';
import type { SceneEngineInput } from './types';

const MAX_REQUESTED_SCENE_COUNT = 500;

/**
 * Robust array check. `Array.isArray` alone is insufficient against a prototype-
 * severed array (replacing `__proto__` leaves `isArray` true while breaking the
 * inherited `Symbol.iterator`), which would otherwise surface as an uncaught
 * `TypeError` during downstream iteration. Requiring a callable `Symbol.iterator`
 * keeps the contract fail-closed against prototype pollution.
 */
function isSafeArray(value: unknown): value is readonly unknown[] {
  return (
    Array.isArray(value) &&
    typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function'
  );
}

export function validateSceneEngineInput(input: SceneEngineInput): readonly ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  const { session } = input;

  if (!Number.isInteger(session.requestedSceneCount) || session.requestedSceneCount < 1) {
    failures.push(
      sceneFailureFromCode('SE_INTERNAL_LIMIT', 'session.requestedSceneCount', {
        detail: 'must be a positive integer',
      }),
    );
  } else if (session.requestedSceneCount > MAX_REQUESTED_SCENE_COUNT) {
    failures.push(
      sceneFailureFromCode('SE_INTERNAL_LIMIT', 'session.requestedSceneCount', {
        detail: `exceeds safety limit ${MAX_REQUESTED_SCENE_COUNT}`,
      }),
    );
  }

  if (!isSafeArray(session.productIds) || session.productIds.length === 0) {
    failures.push(
      sceneFailureFromCode('SE_INTERNAL_LIBRARY_GAP', 'session.productIds', {
        detail: 'must be non-empty',
      }),
    );
  }

  if (
    !isSafeArray(session.colorSelection?.colorIds) ||
    session.colorSelection.colorIds.length === 0
  ) {
    failures.push(
      sceneFailureFromCode('SE_INTERNAL_LIBRARY_GAP', 'session.colorSelection.colorIds', {
        detail: 'must be non-empty',
      }),
    );
  }

  if (typeof input.observePrintArea !== 'function') {
    failures.push(
      sceneFailureFromCode('SE_INTERNAL_OBSERVER_CONTRACT', 'observePrintArea', {
        detail: 'must be a function',
      }),
    );
  }

  if (!isSafeArray(input.constraints)) {
    failures.push(
      sceneFailureFromCode('SE_INTERNAL_LIMIT', 'constraints', { detail: 'must be an array' }),
    );
  }

  if (!isSafeArray(input.products) || input.products.length === 0) {
    failures.push(
      sceneFailureFromCode('SE_INTERNAL_LIBRARY_GAP', 'products', { detail: 'must be non-empty' }),
    );
  }

  const library = input.library;
  const requiredPools: readonly [string, unknown][] = [
    ['library.templates', library?.templates],
    ['library.locations', library?.locations],
    ['library.lightings', library?.lightings],
    ['library.cameras', library?.cameras],
    ['library.compositions', library?.compositions],
    ['library.poses', library?.poses],
  ];
  for (const [field, pool] of requiredPools) {
    if (!isSafeArray(pool) || pool.length === 0) {
      failures.push(
        sceneFailureFromCode('SE_INTERNAL_LIBRARY_GAP', field, { detail: 'must be non-empty' }),
      );
    }
  }
  if (!isSafeArray(library?.decors)) {
    failures.push(
      sceneFailureFromCode('SE_INTERNAL_LIBRARY_GAP', 'library.decors', {
        detail: 'must be an array (may be empty)',
      }),
    );
  }
  if (!isSafeArray(library?.props)) {
    failures.push(
      sceneFailureFromCode('SE_INTERNAL_LIBRARY_GAP', 'library.props', {
        detail: 'must be an array (may be empty)',
      }),
    );
  }

  if (!isSafeArray(input.dedupLedger?.seen)) {
    failures.push(
      sceneFailureFromCode('SE_INTERNAL_LIMIT', 'dedupLedger.seen', { detail: 'must be an array' }),
    );
  }

  return failures;
}
