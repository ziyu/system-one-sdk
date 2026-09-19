import type { SystemOneOptions as CoreOptions, SystemOneAdapter, Transport, Fetch } from '@system-one-ai/core';
export type * from '@system-one-ai/core';

/** Compatibility options with a default native adapter and Fetch transport. */
export interface SystemOneOptions extends Omit<CoreOptions, 'adapter' | 'transport'> {
  readonly adapter?: SystemOneAdapter;
  readonly transport?: Transport;
  readonly fetch?: Fetch;
}
