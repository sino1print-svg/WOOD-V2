/**
 * shared/errors — public surface. Data-only error catalog (no engine logic).
 */
export type { ErrorEntry, ErrorNamespace } from './types';
export { ERROR_REGISTRY, ERROR_BY_CODE } from './registry';
