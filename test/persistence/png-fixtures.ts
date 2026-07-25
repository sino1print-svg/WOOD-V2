function u32(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export function pngChunk(type: string, data = new Uint8Array()): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const crcInput = concat([typeBytes, data]);
  return concat([u32(data.length), typeBytes, data, u32(crc32(crcInput))]);
}

export interface SmallPngOptions {
  readonly width?: number;
  readonly height?: number;
  readonly transparent?: boolean;
  readonly dpi?: number;
  readonly extraChunks?: readonly Uint8Array[];
  readonly includeIend?: boolean;
  readonly trailing?: Uint8Array;
}

export function makeSmallPng(options: SmallPngOptions = {}): Uint8Array {
  const width = options.width ?? 1;
  const height = options.height ?? 1;
  const ihdr = concat([
    u32(width),
    u32(height),
    new Uint8Array([8, options.transparent === false ? 2 : 6, 0, 0, 0]),
  ]);
  const chunks: Uint8Array[] = [pngChunk('IHDR', ihdr)];
  if (options.dpi !== undefined) {
    const pixelsPerMeter = Math.round(options.dpi / 0.0254);
    chunks.push(
      pngChunk('pHYs', concat([u32(pixelsPerMeter), u32(pixelsPerMeter), new Uint8Array([1])])),
    );
  }
  chunks.push(...(options.extraChunks ?? []));
  chunks.push(pngChunk('IDAT'));
  if (options.includeIend !== false) chunks.push(pngChunk('IEND'));
  if (options.trailing) chunks.push(options.trailing);
  return concat([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]);
}

export function corruptLastByte(bytes: Uint8Array): Uint8Array {
  const copy = bytes.slice();
  copy[copy.length - 1] ^= 1;
  return copy;
}

export function malformedChunkBoundsPng(): Uint8Array {
  const valid = makeSmallPng();
  const copy = valid.slice(0, 20);
  copy[8] = 0x7f;
  copy[9] = 0xff;
  copy[10] = 0xff;
  copy[11] = 0xff;
  return copy;
}
