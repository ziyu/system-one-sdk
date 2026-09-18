import { denseArray, identifier, record } from './composition.js';
import { ConfigurationError, RequestAbortedError, ValidationError } from './errors.js';
import { snapshotHeaders } from './transport.js';
import type { EvaluateRequest, EvaluationClient, EvaluationResult, Questions, RequestOptions, Usage } from './types.js';
import { configInteger, snapshotRequest } from './validation.js';

export interface BatchItem<Q extends Questions = Questions> {
  readonly id: string;
  readonly request: EvaluateRequest<Q>;
}
export type BatchItemResult<Q extends Questions = Questions, Id extends string = string> = {
  readonly id: Id;
  readonly index: number;
} & (
  | { readonly status: 'fulfilled'; readonly started: true; readonly value: EvaluationResult<Q> }
  | { readonly status: 'rejected'; readonly started: boolean; readonly error: unknown }
  | { readonly status: 'cancelled'; readonly started: boolean; readonly error: RequestAbortedError }
);
export type BatchResults<I extends readonly BatchItem[]> = {
  readonly [K in keyof I]: BatchItemResult<I[K]['request']['questions'], I[K]['id']>;
};
export interface BatchOptions {
  /** Maximum simultaneous evaluations, including each evaluation's retries. Default: 4. */
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
  /** Per-evaluation settings. Queue time is outside timeoutMs; signal belongs to the batch. */
  readonly requestOptions?: Omit<RequestOptions, 'signal'>;
}
export interface BatchSummary {
  readonly total: number;
  /** Number of calls started on the supplied client's evaluate method, not HTTP attempts. */
  readonly started: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly durationMs: number;
  /** HTTP attempts reported by successful results only. Failed calls may also consume usage. */
  readonly successfulAttempts: number;
  /** Sums of known usage from successful results; omitted when unavailable or unsafe to sum. */
  readonly reportedUsage: Usage;
  /** Number of successful results contributing each token count. Never implies complete billing. */
  readonly usageCoverage: Readonly<Record<keyof Usage, number>>;
}
export interface BatchResult<I extends readonly BatchItem[]> {
  readonly items: BatchResults<I>;
  readonly summary: BatchSummary;
}

/**
 * Client-side bounded concurrency, with input-order results and no hidden retries.
 * Invalid batch configuration rejects before I/O; individual failures remain in items.
 * Cancellation resolves a partial report, aborts active calls and never starts queued work.
 */
export async function evaluateMany<const I extends readonly BatchItem[]>(client: EvaluationClient, items: I, options: BatchOptions = {}): Promise<BatchResult<I>> {
  const start = Date.now();
  if (!client || typeof client.evaluate !== 'function') throw new ConfigurationError('client must implement evaluate.');
  record(options, 'batch.options', ['concurrency', 'signal', 'requestOptions']);
  const concurrency = configInteger(options.concurrency ?? 4, 'concurrency', 1);
  denseArray(items, 'batch.items');
  const requestOptions = options.requestOptions ?? {};
  record(requestOptions, 'batch.requestOptions', ['timeoutMs', 'maxRetries', 'headers']);
  if (requestOptions.timeoutMs !== undefined) configInteger(requestOptions.timeoutMs, 'timeoutMs', 1);
  if (requestOptions.maxRetries !== undefined) configInteger(requestOptions.maxRetries, 'maxRetries', 0, 100);
  const commonOptions = {
    ...requestOptions,
    ...(requestOptions.headers === undefined ? {} : { headers: snapshotHeaders(requestOptions.headers) }),
  };
  const signal = options.signal;
  if (signal !== undefined && (signal === null || typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) {
    throw new ConfigurationError('signal must be an AbortSignal.');
  }
  const ids = new Set<string>();
  // Validate all correlation IDs before any request can be dispatched.
  const inputs = items.map((item, index) => {
    record(item, `batch.items[${index}]`, ['id', 'request']);
    identifier(item.id, `batch.items[${index}].id`);
    if (ids.has(item.id)) throw new ValidationError('batch.items', 'item IDs must be unique');
    ids.add(item.id);
    return { id: item.id, request: item.request };
  });
  const results: BatchItemResult[] = new Array(inputs.length);
  const snapshots = inputs.map((item, index) => {
    try { return snapshotRequest(item.request); }
    catch (error) {
      results[index] = { id: item.id, index, status: 'rejected', started: false, error };
      return undefined;
    }
  });
  let cancelled = signal?.aborted ?? false;
  const active = new Set<() => void>();
  const onAbort = () => {
    cancelled = true;
    for (const abort of [...active]) abort();
  };
  let next = 0;
  let started = 0;

  function call(request: EvaluateRequest): Promise<EvaluationResult<Questions>> {
    const controller = new AbortController();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (result: { value: EvaluationResult<Questions> } | { error: unknown }) => {
        if (settled) return;
        settled = true;
        active.delete(abort);
        if ('error' in result) reject(result.error);
        else resolve(result.value);
      };
      const abort = () => {
        // Settle first: a custom client's synchronous abort listener must not change the outcome.
        const error = new RequestAbortedError();
        finish({ error });
        controller.abort(error);
      };
      active.add(abort);
      if (cancelled) { abort(); return; }
      try {
        started++;
        // A separate Headers snapshot per call prevents custom wrappers mutating later requests.
        const callOptions = { ...commonOptions, ...(commonOptions.headers === undefined ? {} : { headers: snapshotHeaders(commonOptions.headers) }), signal: controller.signal };
        Promise.resolve(client.evaluate(request, callOptions)).then(
          value => finish({ value }), error => finish({ error }),
        );
      } catch (error) { finish({ error }); }
    });
  }

  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= inputs.length) return;
      if (results[index] !== undefined) continue;
      const id = inputs[index]!.id;
      if (cancelled) {
        results[index] = { id, index, status: 'cancelled', started: false, error: new RequestAbortedError() };
        continue;
      }
      try {
        const value = await call(snapshots[index]!);
        results[index] = { id, index, status: 'fulfilled', started: true, value };
      } catch (error) {
        results[index] = cancelled && error instanceof RequestAbortedError
          ? { id, index, status: 'cancelled', started: true, error }
          : { id, index, status: 'rejected', started: true, error };
      }
    }
  }

  if (!cancelled) signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker()));
  } finally { signal?.removeEventListener('abort', onAbort); }

  const successes = results.filter(result => result.status === 'fulfilled');
  const reportedUsage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } = {};
  const usageCoverage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens'] as const) {
    let sum = 0;
    for (const item of successes) {
      const count = item.value.usage[key];
      if (count !== undefined) { sum += count; usageCoverage[key]++; }
    }
    if (usageCoverage[key] > 0 && Number.isSafeInteger(sum)) reportedUsage[key] = sum;
  }
  return {
    items: results as BatchResults<I>,
    summary: {
      total: inputs.length, started, succeeded: successes.length,
      failed: results.filter(result => result.status === 'rejected').length,
      cancelled: results.filter(result => result.status === 'cancelled').length,
      durationMs: Date.now() - start,
      successfulAttempts: successes.reduce((sum, item) => sum + item.value.response.attempts, 0),
      reportedUsage, usageCoverage,
    },
  };
}
