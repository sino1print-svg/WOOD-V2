/**
 * Hostile-input protection for the packaging-specific input fields (exportId,
 * createdAt, versions) - EX section 3.11/21. The plan/limits portion of the
 * input is validated by the existing Batch 10.3 `prepareFormatterInput` gate;
 * this module only covers the fields packaging adds on top of it.
 */
import { PromptModuleType } from '../../shared/domain-model';
import type { ExportEngineVersions } from '../../shared/contracts/export-contracts';
import { hasExactKeys, isPlainRecord } from '../runtime';

const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SEMVER_LIKE = /^[0-9A-Za-z.+-]{1,64}$/u;
const PROMPT_MODULE_TYPES: readonly string[] = Object.values(PromptModuleType);
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Pure calendar-arithmetic validation (no `Date` object, no wall-clock read):
 * rejects a syntactically well-formed but impossible timestamp such as month
 * 13, February 30, hour 24, or minute/second 60.
 */
function isValidCalendarTimestamp(value: string): boolean {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const second = Number(value.slice(17, 19));
  if (month < 1 || month > 12) return false;
  const maxDay = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1]!;
  if (day < 1 || day > maxDay) return false;
  if (hour > 23) return false;
  if (minute > 59) return false;
  if (second > 59) return false;
  return true;
}

function isControlFree(value: string, maxLength: number): boolean {
  if (value.length === 0 || value.length > maxLength) return false;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return true;
}

export function isValidExportId(value: unknown): value is string {
  return typeof value === 'string' && isControlFree(value, 512);
}

export function isValidCreatedAt(value: unknown): value is string {
  return (
    typeof value === 'string' && TIMESTAMP_PATTERN.test(value) && isValidCalendarTimestamp(value)
  );
}

function isSemVerLike(value: unknown): value is string {
  return typeof value === 'string' && SEMVER_LIKE.test(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isRuleSetVersions(value: unknown, maxEntries: number): boolean {
  if (!isPlainRecord(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > maxEntries) return false;
  return entries.every(([key, item]) => isControlFree(key, 512) && isPositiveInteger(item));
}

function isPromptModuleVersions(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  return hasExactKeys(value, PROMPT_MODULE_TYPES) && Object.values(value).every(isSemVerLike);
}

/** Validate the packaging-specific `versions` input without invoking any getter. */
export function isValidExportEngineVersions(
  value: unknown,
  maxEntries: number,
): value is ExportEngineVersions {
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, [
      'applicationVersion',
      'generatorVersion',
      'ruleSetVersions',
      'promptModuleVersions',
    ]) &&
    isSemVerLike(value.applicationVersion) &&
    isSemVerLike(value.generatorVersion) &&
    isRuleSetVersions(value.ruleSetVersions, maxEntries) &&
    isPromptModuleVersions(value.promptModuleVersions)
  );
}
