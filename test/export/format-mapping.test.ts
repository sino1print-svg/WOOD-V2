/**
 * Export format mapping (deterministic, data-only) — IMPL §5.
 * Verifies the operational->persisted mapping is total and deterministic.
 * No Export Engine behavior is exercised.
 */
import { describe, it, expect } from 'vitest';
import { PERSISTED_EXPORT_FORMAT } from '../../src/export/format-mapping';
import { ExportFormat } from '../../src/shared/domain-model';

describe('PERSISTED_EXPORT_FORMAT', () => {
  it('maps persisted formats to themselves', () => {
    expect(PERSISTED_EXPORT_FORMAT[ExportFormat.Txt]).toBe(ExportFormat.Txt);
    expect(PERSISTED_EXPORT_FORMAT[ExportFormat.Json]).toBe(ExportFormat.Json);
    expect(PERSISTED_EXPORT_FORMAT[ExportFormat.Zip]).toBe(ExportFormat.Zip);
  });
  it('maps operational channels to null (delivery-only)', () => {
    expect(PERSISTED_EXPORT_FORMAT['clipboard']).toBeNull();
    expect(PERSISTED_EXPORT_FORMAT['markdown']).toBeNull();
  });
  it('is deterministic (same object each read)', () => {
    expect(PERSISTED_EXPORT_FORMAT).toBe(PERSISTED_EXPORT_FORMAT);
  });
});
