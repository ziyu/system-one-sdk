import { ConfigurationError } from '@system-one-ai/core';
import type { SystemOne } from '@system-one-ai/core';
import { createLocalClient, type LocalModelRunner } from '@system-one-ai/adapter-local';

export type BrowserInferenceDevice = 'auto' | 'webgpu' | 'wasm';

export interface BrowserModelRunner extends LocalModelRunner {
  dispose?(): Promise<void>;
}

export interface BrowserDriverContext {
  readonly device: BrowserInferenceDevice;
}

/** A model-family specific loader. New browser model support plugs in here. */
export interface BrowserModelDriver {
  readonly id: string;
  readonly defaultTimeoutMs?: number;
  createRunner(context: BrowserDriverContext): Promise<BrowserModelRunner>;
}

export interface BrowserRunnerOptions {
  readonly driver: BrowserModelDriver;
  readonly device?: BrowserInferenceDevice;
}

export interface BrowserClientOptions extends BrowserRunnerOptions {
  readonly timeoutMs?: number;
}

export type BrowserClient = SystemOne & { dispose(): Promise<void> };

function deviceOf(value: BrowserInferenceDevice | undefined): BrowserInferenceDevice {
  const device = value ?? 'auto';
  if (device !== 'auto' && device !== 'webgpu' && device !== 'wasm') {
    throw new ConfigurationError('device must be auto, webgpu, or wasm.');
  }
  return device;
}

function assertDriver(driver: BrowserModelDriver): void {
  if (!driver || typeof driver !== 'object' || typeof driver.id !== 'string' || driver.id.trim() === '' || typeof driver.createRunner !== 'function') {
    throw new ConfigurationError('driver must provide a nonempty id and createRunner().');
  }
}

/** Create a local runner from any browser model driver. */
export async function createBrowserRunner(options: BrowserRunnerOptions): Promise<BrowserModelRunner> {
  assertDriver(options?.driver);
  return options.driver.createRunner({ device: deviceOf(options.device) });
}

/** Create the stable browser-local System One client, independent of model family. */
export async function createBrowserClient(options: BrowserClientOptions): Promise<BrowserClient> {
  const runner = await createBrowserRunner(options);
  const timeoutMs = options.timeoutMs ?? options.driver.defaultTimeoutMs ?? 120_000;
  try {
    const client = createLocalClient(runner, { apiKey: null, timeoutMs });
    return Object.assign(client, { dispose: async () => { await runner.dispose?.(); } });
  } catch (error) {
    await runner.dispose?.();
    throw error;
  }
}
