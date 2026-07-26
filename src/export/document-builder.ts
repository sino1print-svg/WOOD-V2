import { encodeUtf8, utf8ByteLength } from './utf8';
import { LF, isSystemLine } from './line-endings';

export interface BuiltTextDocument {
  readonly text: string;
  readonly bytes: Uint8Array;
  readonly byteLength: number;
}

/**
 * Bounded append-only builder. It counts UTF-8 bytes before joining or encoding,
 * so an oversized document fails without allocating its final byte array.
 */
export class BoundedDocumentBuilder {
  readonly #fragments: string[] = [];
  readonly #maximumBytes: number;
  #byteLength = 0;
  #valid = true;

  constructor(maximumBytes: number) {
    this.#maximumBytes = maximumBytes;
  }

  append(value: string): boolean {
    if (!this.#valid) return false;
    const nextLength = this.#byteLength + utf8ByteLength(value);
    if (!Number.isSafeInteger(nextLength) || nextLength > this.#maximumBytes) {
      this.#valid = false;
      return false;
    }
    this.#fragments.push(value);
    this.#byteLength = nextLength;
    return true;
  }

  appendSystemLine(value = ''): boolean {
    if (!isSystemLine(value)) {
      this.#valid = false;
      return false;
    }
    return this.append(value) && this.append(LF);
  }

  finish(): BuiltTextDocument | null {
    if (!this.#valid) return null;
    const text = this.#fragments.join('');
    const bytes = encodeUtf8(text);
    if (bytes.byteLength !== this.#byteLength || bytes.byteLength > this.#maximumBytes) {
      return null;
    }
    return { text, bytes, byteLength: bytes.byteLength };
  }
}
