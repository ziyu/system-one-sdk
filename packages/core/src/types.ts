export type JsonValue = string | number | boolean | null | JsonObject | readonly JsonValue[];
export interface JsonObject { readonly [key: string]: JsonValue }
/** Description primitives accepted by System One models; nested values may be any JSON. */
export type Description = string | JsonObject | readonly JsonValue[] | null;
/** An array is one shared state, not a batch of independent evaluations. */
export type State = Exclude<Description, null>;
export type ChoiceCriteria = Readonly<Record<string, Description>>;

export interface ChoiceQuestion<C extends ChoiceCriteria = ChoiceCriteria> {
  readonly type: 'choice';
  readonly instructions: Description;
  readonly criteria: C;
}
export interface ScoreQuestion<C extends readonly Description[] = readonly Description[]> {
  readonly type: 'score';
  readonly instructions: Description;
  readonly criteria: C;
}
export interface BooleanQuestion {
  readonly type: 'boolean';
  readonly instructions: Description;
  readonly criteria?: { readonly true?: Description; readonly false?: Description };
}
export type Question = ChoiceQuestion | ScoreQuestion | BooleanQuestion;
export type QuestionType = Question['type'];
export type Questions = Readonly<Record<string, Question>>;

export interface ChoiceAnswer<K extends string = string> {
  readonly type: 'choice';
  readonly choice: K;
  readonly probabilities?: Readonly<Record<K, number>>;
  /** Provider-reported statistic, not necessarily P(selected option) or comparable across models. */
  readonly confidence?: number;
}
export interface ScoreAnswer {
  readonly type: 'score';
  readonly score: number;
  readonly probabilities?: Readonly<Record<string, number>>;
  readonly confidence?: number;
  readonly legend?: Readonly<Record<string, Description>>;
}
export interface BooleanAnswer {
  readonly type: 'boolean';
  /** P(true), not a thresholded boolean and not confidence in either outcome. */
  readonly probability: number;
}
export type Answer = ChoiceAnswer | ScoreAnswer | BooleanAnswer;
export type AnswerFor<Q extends Question> =
  Q extends ChoiceQuestion<infer C> ? ChoiceAnswer<`${Extract<keyof C, string | number>}`> :
  Q extends ScoreQuestion ? ScoreAnswer : BooleanAnswer;
export type Answers<Q extends Questions> = { readonly [K in keyof Q]: AnswerFor<Q[K]> };

export interface Usage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  /** Defined only when both component counts are available. */
  readonly totalTokens?: number;
}
export interface Rounding {
  readonly probabilityDecimals?: number;
  readonly scoreDecimals?: number;
}
export interface EvaluateRequest<Q extends Questions = Questions> {
  readonly state: State;
  readonly questions: Q;
  readonly model?: string;
  readonly providerOptions?: JsonObject;
}
export interface RequestOptions {
  readonly signal?: AbortSignal;
  /** Total budget for this call, including key resolution, retries, backoff, and body reading. */
  readonly timeoutMs?: number;
  /** Number of extra attempts; set to zero for latency-sensitive loops. */
  readonly maxRetries?: number;
  readonly headers?: HeadersInit;
}
export interface EvaluationResult<Q extends Questions> {
  /** Upstream's resolved model ID when provided; otherwise the requested model ID. */
  readonly model: string;
  readonly answers: Answers<Q>;
  readonly usage: Usage;
  readonly rounding?: Rounding;
  readonly warnings: readonly JsonValue[];
  readonly providerMetadata?: JsonObject;
  readonly response: {
    readonly requestId?: string;
    readonly status: number;
    readonly attempts: number;
    readonly durationMs: number;
    readonly adapter: string;
  };
}

/** Structural interface shared by optional composition modules and application wrappers. */
export interface EvaluationClient {
  evaluate<const Q extends Questions>(request: EvaluateRequest<Q>, options?: RequestOptions): Promise<EvaluationResult<Q>>;
}

export interface AdapterContext {
  readonly baseURL: string;
  readonly model: string;
  readonly request: EvaluateRequest;
}
export interface PreparedRequest {
  readonly url: string;
  /** JSON-serializable data. Validated before authentication or network I/O. */
  readonly body: unknown;
  readonly headers?: HeadersInit;
}
/** Normalized envelope returned by an adapter, then validated by the client. */
export interface ProviderResponse {
  readonly model?: string;
  readonly answers: Readonly<Record<string, Answer>>;
  readonly usage?: Usage;
  readonly rounding?: Rounding;
  readonly warnings?: readonly JsonValue[];
  readonly providerMetadata?: JsonObject;
}
export interface SystemOneAdapter {
  readonly id: string;
  /** Used when SystemOneOptions.baseURL is omitted. Factories can include an account or tenant. */
  readonly defaultBaseURL?: string;
  /** Used when neither the client nor the evaluation explicitly selects a model. */
  readonly defaultModel?: string;
  readonly supportedQuestionTypes: readonly QuestionType[];
  /** Synchronous codec. Network I/O, cancellation, and retries belong to the client. */
  prepare(context: AdapterContext): PreparedRequest;
  /** Return a ProviderResponse envelope. The unknown boundary is deliberately runtime-validated. */
  decode(payload: unknown, context: AdapterContext): unknown;
  /** Omit for standard Bearer authentication. Useful for future x-api-key protocols. */
  authenticate?(apiKey: string | null): HeadersInit;
}
export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type ApiKey = string | null | (() => string | null | Promise<string | null>);
export interface SystemOneOptions {
  /** Optional override for a proxy or compatible service. Built-in adapters supply their own URL. */
  readonly baseURL?: string;
  /** Explicit null supports an unauthenticated local server or same-origin application proxy. */
  readonly apiKey: ApiKey;
  /** Optional override of the adapter's default model. */
  readonly model?: string;
  /** Protocol behavior is supplied by an independently installed adapter package. */
  readonly adapter: SystemOneAdapter;
  readonly fetch?: Fetch;
  readonly headers?: HeadersInit;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
  readonly maxRetryDelayMs?: number;
  readonly maxResponseBytes?: number;
}
