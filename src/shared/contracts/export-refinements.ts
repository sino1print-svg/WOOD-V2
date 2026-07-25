/**
 * Export operational refinements — CONTRACTS LAYER, TYPE-ONLY (IMPL §5; EX §4).
 *
 * Operational UI/export delivery selectors (Clipboard, Markdown) must NOT widen the
 * persisted `ExportFormat` enum and must live outside the persisted domain model.
 * This file contains ONLY types. The runtime mapping table lives in the export
 * infrastructure layer: `src/export/format-mapping.ts`.
 */
import type { ExportFormat } from '../domain-model';

/** Operational delivery channels beyond the persisted formats. */
export type ExportDeliveryChannel = 'clipboard' | 'markdown';

/** Operational delivery format = persisted format OR an operational channel. */
export type ExportDeliveryFormat = ExportFormat | ExportDeliveryChannel;
