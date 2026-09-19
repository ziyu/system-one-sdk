import { ConfigurationError, SystemOne as CoreSystemOne } from '@system-one-ai/core';
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import { systemOneAdapter } from '@system-one-ai/adapter-system-one';
import type { SystemOneOptions } from './types.js';

/** Compatibility facade: supplies the native adapter and Fetch defaults. */
export class SystemOne extends CoreSystemOne {
  constructor(options: SystemOneOptions) {
    if (!options || !('apiKey' in options)) throw new ConfigurationError('Provide apiKey explicitly; use null only for an unauthenticated endpoint.');
    if (options.transport !== undefined && options.fetch !== undefined) throw new ConfigurationError('Pass transport or fetch, not both.');
    super({
      ...options,
      adapter: options.adapter ?? systemOneAdapter,
      transport: options.transport ?? createFetchTransport(options.fetch),
    });
  }
}

export function createSystemOne(options: SystemOneOptions): SystemOne { return new SystemOne(options); }
