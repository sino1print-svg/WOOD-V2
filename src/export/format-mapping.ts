/**
 * Export delivery-format mapping — EXPORT INFRASTRUCTURE (IMPL §5).
 *
 * Deterministic, declarative lookup from an operational `ExportDeliveryFormat`
 * to the persisted `ExportFormat` (or null for delivery-only channels such as
 * clipboard/markdown). Data only — NOT Export Engine behavior, no business logic.
 */
import { ExportFormat } from '../shared/domain-model';
import type { ExportDeliveryFormat } from '../shared/contracts';

export const PERSISTED_EXPORT_FORMAT: Readonly<Record<ExportDeliveryFormat, ExportFormat | null>> =
  {
    [ExportFormat.Txt]: ExportFormat.Txt,
    [ExportFormat.Json]: ExportFormat.Json,
    [ExportFormat.Zip]: ExportFormat.Zip,
    clipboard: null,
    markdown: null,
  };
