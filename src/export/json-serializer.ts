import { BoundedDocumentBuilder, type BuiltTextDocument } from './document-builder';
import { compareUtf8, isPlainRecord } from './runtime';

export type ExportJsonPrimitive = string | number | boolean | null;
export type ExportJsonValue = ExportJsonPrimitive | readonly ExportJsonValue[] | ExportJsonObject;
export interface ExportJsonObject {
  readonly [key: string]: ExportJsonValue;
}

export interface JsonSerializationOptions {
  readonly indentation: 0 | 2;
  readonly trailingLf: boolean;
  readonly maximumBytes: number;
  readonly maximumDepth: number;
  readonly maximumArrayLength: number;
}

export function quoteJsonString(text: string): string {
  const encoded = JSON.stringify(text);
  return typeof encoded === 'string' ? encoded : '""';
}

function isDenseJsonArray(value: readonly unknown[], maximum: number): boolean {
  if (value.length > maximum || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const keys = Object.keys(value);
  return (
    keys.length === value.length &&
    keys.every((key) => {
      const index = Number(key);
      return (
        Number.isSafeInteger(index) && index >= 0 && index < value.length && String(index) === key
      );
    })
  );
}

function writeIndent(builder: BoundedDocumentBuilder, depth: number, indentation: 0 | 2): boolean {
  return indentation === 0 || builder.append(' '.repeat(depth * indentation));
}

function writeArray(
  builder: BoundedDocumentBuilder,
  value: readonly unknown[],
  depth: number,
  options: JsonSerializationOptions,
): boolean {
  if (!isDenseJsonArray(value, options.maximumArrayLength)) return false;
  if (!builder.append('[')) return false;
  if (value.length === 0) return builder.append(']');

  for (let index = 0; index < value.length; index += 1) {
    if (index > 0 && !builder.append(',')) return false;
    if (options.indentation === 2) {
      if (!builder.append('\n') || !writeIndent(builder, depth + 1, options.indentation))
        return false;
    }
    const item = value[index];
    if (item === undefined || !writeJson(builder, item, depth + 1, options)) return false;
  }
  if (options.indentation === 2) {
    if (!builder.append('\n') || !writeIndent(builder, depth, options.indentation)) return false;
  }
  return builder.append(']');
}

function writeObject(
  builder: BoundedDocumentBuilder,
  value: Record<string, unknown>,
  depth: number,
  options: JsonSerializationOptions,
): boolean {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value).sort(compareUtf8);
  if (keys.some((key) => key === '__proto__' || key === 'prototype' || key === 'constructor')) {
    return false;
  }
  if (!builder.append('{')) return false;
  if (keys.length === 0) return builder.append('}');

  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === undefined) return false;
    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor)) return false;
    if (index > 0 && !builder.append(',')) return false;
    if (options.indentation === 2) {
      if (!builder.append('\n') || !writeIndent(builder, depth + 1, options.indentation))
        return false;
    }
    if (!builder.append(quoteJsonString(key))) return false;
    if (!builder.append(options.indentation === 2 ? ': ' : ':')) return false;
    if (!writeJson(builder, descriptor.value, depth + 1, options)) return false;
  }
  if (options.indentation === 2) {
    if (!builder.append('\n') || !writeIndent(builder, depth, options.indentation)) return false;
  }
  return builder.append('}');
}

function writeJson(
  builder: BoundedDocumentBuilder,
  value: unknown,
  depth: number,
  options: JsonSerializationOptions,
): boolean {
  if (depth > options.maximumDepth) return false;
  if (value === null) return builder.append('null');
  if (typeof value === 'string') return builder.append(quoteJsonString(value));
  if (typeof value === 'boolean') return builder.append(value ? 'true' : 'false');
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) return false;
    return builder.append(String(value));
  }
  if (Array.isArray(value)) return writeArray(builder, value, depth, options);
  if (isPlainRecord(value)) return writeObject(builder, value, depth, options);
  return false;
}

/** Serialize an owned allowlisted DTO; never calls toJSON or a replacer. */
export function serializeExportJson(
  value: ExportJsonObject,
  options: JsonSerializationOptions,
): BuiltTextDocument | null {
  const builder = new BoundedDocumentBuilder(options.maximumBytes);
  if (!writeJson(builder, value, 0, options)) return null;
  if (options.trailingLf && !builder.append('\n')) return null;
  return builder.finish();
}
