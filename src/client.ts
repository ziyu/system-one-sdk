import { SystemOne as CoreSystemOne } from '@system-one-ai/core';
import { systemOneAdapter } from './adapters/system-one.js';
import type { SystemOneOptions } from './types.js';

/** Compatibility facade: the evaluation lifecycle lives in @system-one-ai/core. */
export class SystemOne extends CoreSystemOne {
  constructor(options: SystemOneOptions) {
    super({ ...options, adapter: options.adapter ?? systemOneAdapter });
  }
}

export function createSystemOne(options: SystemOneOptions): SystemOne {
  return new SystemOne(options);
}
