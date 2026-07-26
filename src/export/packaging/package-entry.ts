/**
 * Package entry construction - EX section 11/12. Reuses the Batch 10.3
 * `ExportArtifact` shape so packaging introduces no parallel entry type.
 */
import type {
  ExportArtifact,
  ExportArtifactKind,
  ExportArtifactMediaType,
  ExportFileFormat,
} from '../../shared/contracts/export-contracts';
import { sha256Bytes } from './checksum';

/** A file inside the package: final bytes plus the resolved ZIP-relative path. */
export type PackageEntry = ExportArtifact;

export function makeEntry(
  path: string,
  kind: ExportArtifactKind,
  format: ExportFileFormat,
  mediaType: ExportArtifactMediaType,
  bytes: Uint8Array,
): PackageEntry {
  return {
    path,
    kind,
    format,
    mediaType,
    bytes,
    byteLength: bytes.byteLength,
    checksum: sha256Bytes(bytes),
  };
}
