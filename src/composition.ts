import { ValidationError } from './errors.js';
import { isRecord } from './validation.js';

/** Inspect non-JSON configuration without invoking accessors or accepting hidden fields. */
export function record(value: unknown, path: string, keys?: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) throw new ValidationError(path, 'expected a plain object');
  if (Object.getOwnPropertySymbols(value).length) throw new ValidationError(path, 'symbol properties are unsupported');
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in descriptor) || !descriptor.enumerable) throw new ValidationError(path, 'expected enumerable data properties');
    if (keys && !keys.includes(key)) throw new ValidationError(path, 'contains an unsupported field');
  }
  return value;
}

export function identifier(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new ValidationError(path, 'expected a nonempty string');
}

export function denseArray(value: unknown, path: string): asserts value is readonly unknown[] {
  if (!Array.isArray(value)) throw new ValidationError(path, 'expected an array');
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor)) throw new ValidationError(path, 'sparse arrays and accessors are unsupported');
  }
}

/** Only use on SDK-owned, validated JSON snapshots; never freeze business objects. */
export function freezeJson<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}
