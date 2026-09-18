export type ErrorCode = 'configuration' | 'validation' | 'unsupported' | 'response' | 'http' | 'network' | 'timeout' | 'aborted';

export class SystemOneError extends Error {
  constructor(message: string, readonly code: ErrorCode) {
    super(message);
    this.name = new.target.name;
  }
}
export class ConfigurationError extends SystemOneError {
  constructor(message: string) { super(message, 'configuration'); }
}
export class ValidationError extends SystemOneError {
  constructor(readonly path: string, message: string) { super(`${path}: ${message}`, 'validation'); }
}
export class UnsupportedFeatureError extends SystemOneError {
  constructor(message: string) { super(message, 'unsupported'); }
}
export class ResponseValidationError extends SystemOneError {
  constructor(readonly path: string, message: string) { super(`${path}: ${message}`, 'response'); }
}
export class APIError extends SystemOneError {
  constructor(
    readonly statusCode: number,
    readonly requestId: string | undefined,
    readonly retryAfterMs: number | undefined,
  ) {
    // Upstream error bodies may echo request data or credentials. Do not attach or log them.
    super(`System One API returned HTTP ${statusCode}.`, 'http');
  }
  get retryable(): boolean {
    return this.statusCode === 408 || this.statusCode === 429 || this.statusCode >= 500 && this.statusCode <= 599;
  }
}
export class ConnectionError extends SystemOneError {
  constructor() { super('The System One request could not be completed due to a network error.', 'network'); }
}
export class TimeoutError extends SystemOneError {
  constructor() { super('The evaluation could not complete within its total time budget.', 'timeout'); }
}
export class RequestAbortedError extends SystemOneError {
  constructor() { super('The evaluation was cancelled.', 'aborted'); }
}
