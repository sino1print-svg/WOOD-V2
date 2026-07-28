/**
 * Deterministic `checksums.sha256` builder - EX section 3.6/14.
 *
 * `<64-lowercase-hex><two spaces><relative-path>\n`, UTF-8, no BOM, LF only,
 * lines sorted byte-lexicographically by path. Never includes a line for
 * `checksums.sha256` itself (section 3.6 self-reference policy).
 */
import type { Sha256 } from '../../shared/domain-model';
import { BoundedDocumentBuilder, type BuiltTextDocument } from '../document-builder';
import { compareUtf8 } from '../runtime';

export interface ChecksumLine {
  readonly path: string;
  readonly checksum: Sha256;
}

/** Builds the checksums file body. Returns `null` on overflow (fail-closed). */
export function buildChecksumsFile(
  lines: readonly ChecksumLine[],
  maximumBytes: number,
): BuiltTextDocument | null {
  const sorted = [...lines].sort((a, b) => compareUtf8(a.path, b.path));
  const builder = new BoundedDocumentBuilder(maximumBytes);
  for (const line of sorted) {
    if (!builder.appendSystemLine(`${line.checksum}  ${line.path}`)) return null;
  }
  return builder.finish();
}
