import { ResponseValidationError } from '../errors.js';
import type { AdapterContext } from '../types.js';
import { hasOwn, responseRecord } from '../validation.js';
import { systemOneAdapter } from './system-one.js';

function successfulPayload(payload: unknown, path: string): Record<string, unknown> {
  const root = responseRecord(payload, path);
  if (hasOwn(root, 'error')) throw new ResponseValidationError(`${path}.error`, 'Cloudflare returned an error instead of a decision');
  if (hasOwn(root, 'success') && root.success !== true) {
    throw new ResponseValidationError(`${path}.success`, 'expected a successful Cloudflare response');
  }
  if (hasOwn(root, 'errors') && (!Array.isArray(root.errors) || root.errors.length !== 0)) {
    throw new ResponseValidationError(`${path}.errors`, 'Cloudflare returned errors instead of a decision');
  }
  return root;
}

function decisionPayload(payload: unknown, path: string): Record<string, unknown> {
  // At most a REST envelope and an AI runner envelope precede the model result.
  // Validate each layer before unwrapping so a failed runner cannot look successful.
  for (let depth = 0; ; depth++) {
    const root = successfulPayload(payload, path);
    const wrapped = hasOwn(root, 'result');
    if (hasOwn(root, 'state') && (root.state !== 'Completed' || !wrapped)) {
      throw new ResponseValidationError(`${path}.state`, 'expected a completed Cloudflare AI runner result');
    }
    if (!wrapped) return root;
    if (hasOwn(root, 'answers')) {
      throw new ResponseValidationError(path, 'expected either a Cloudflare result envelope or a model result, not both');
    }
    if (depth === 2) throw new ResponseValidationError(path, 'expected a model result after Cloudflare envelopes');
    payload = root.result;
    path += '.result';
  }
}

/** Shared by the REST adapter and native Workers client; this module performs no I/O. */
export function decodeCloudflareResponse(payload: unknown, context: AdapterContext): unknown {
  const result = decisionPayload(payload, 'response');
  const normalized = responseRecord(systemOneAdapter.decode(result, context), 'response');
  const model = result.model ?? context.model;
  const jev = typeof model === 'string' && /^(?:typesafe\/)?jev(?:-|$)/.test(model);
  return {
    ...normalized,
    // Keep Jev's known precision without imposing it on future decision models.
    rounding: result.rounding === undefined && jev ? normalized.rounding : result.rounding,
  };
}
