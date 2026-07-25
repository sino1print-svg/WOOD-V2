/**
 * Error registry types — namespaced per owning engine
 * (RE §14, PE §21, CE §19, EX §19). Declarative data contract only.
 */
import {
  EngineId,
  RuleDomain,
  RulePriorityClass,
  ValidationCheck,
  ValidationSeverity,
} from '../domain-model';

export type ErrorNamespace = 'RULE' | 'PROMPT' | 'COVER' | 'EXPORT';

export interface ErrorEntry {
  readonly code: string;
  readonly namespace: ErrorNamespace;
  readonly originEngine: EngineId;
  readonly severity: ValidationSeverity;
  readonly check: ValidationCheck | null;
  readonly priorityClass: RulePriorityClass | null;
  readonly domain: RuleDomain | null;
  readonly messageAr: string;
  readonly messageEn: string;
}
