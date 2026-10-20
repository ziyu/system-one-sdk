export type JsonValue = string | number | boolean | null | JsonObject | readonly JsonValue[];
export interface JsonObject { readonly [key: string]: JsonValue }
/** Description primitives accepted by System One models; nested values may be any JSON. */
export type Description = string | JsonObject | readonly JsonValue[] | null;
/** An array is one shared state, not a batch of independent evaluations. */
export type State = Exclude<Description, null>;
export type ChoiceCriteria = Readonly<Record<string, Description>>;

/** Embedded image bytes. String inputs must be base64 data URLs, never remote URLs. */
export type ImageInput = string | {
  readonly mediaType: `image/${string}`;
  readonly base64: string;
};

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
  /** Images accompanying the shared state; format and size support depend on the selected model. */
  readonly images?: readonly ImageInput[];
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

export type FieldType = 'text' | 'number' | 'date' | 'time' | 'datetime' | 'duration' | 'list' | 'estimate' | 'forecast';
export type ListItemType = 'text' | 'number' | 'date';
export type DurationUnit = 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'years';
export type EstimateScale = 'linear' | 'log';
export type EstimateStep = number | 'month' | 'year';
export type ForecastInterval = 'step' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

interface FieldBase {
  readonly instructions?: string;
  /** Probability of null above which `value` is null. Default 0.5. */
  readonly nullThreshold?: number;
}
export interface TextFieldSpec extends FieldBase { readonly type: 'text' }
export interface NumberFieldSpec extends FieldBase {
  readonly type: 'number';
  readonly unit?: string;
  readonly integer?: boolean;
  readonly decimals?: number;
}
export interface DateFieldSpec extends FieldBase { readonly type: 'date' }
export interface TimeFieldSpec extends FieldBase { readonly type: 'time' }
export interface DateTimeFieldSpec extends FieldBase { readonly type: 'datetime' }
export interface DurationFieldSpec extends FieldBase {
  readonly type: 'duration';
  readonly unit?: DurationUnit;
  readonly integer?: boolean;
  readonly decimals?: number;
}
export interface ListFieldSpec<I extends ListItemType = ListItemType> {
  readonly type: 'list';
  readonly items: I;
  readonly instructions?: string;
  readonly unit?: string;
  readonly decimals?: number;
}
export interface EstimateFieldSpec extends FieldBase {
  readonly type: 'estimate';
  readonly min: number | string;
  readonly max: number | string;
  readonly step?: EstimateStep;
  readonly scale?: EstimateScale;
  readonly unit?: string;
}
export interface ForecastFieldSpec extends FieldBase {
  readonly type: 'forecast';
  readonly min: number | string;
  readonly max: number | string;
  readonly step?: EstimateStep;
  readonly scale?: EstimateScale;
  readonly unit?: string;
  readonly horizon?: number;
  readonly interval?: ForecastInterval;
}
export type FieldSpec = TextFieldSpec | NumberFieldSpec | DateFieldSpec | TimeFieldSpec | DateTimeFieldSpec
  | DurationFieldSpec | ListFieldSpec | EstimateFieldSpec | ForecastFieldSpec;
export type Fields = Readonly<Record<string, FieldSpec>>;

export interface ExtractOptions {
  /** Applied to scalar fields that omit `nullThreshold`. The service default is 0.5. */
  readonly nullThreshold?: number;
  /** Add all 99 percentiles to estimate and forecast answers. */
  readonly includeQuantiles?: boolean;
  /** Return the text that text/list spans index into. */
  readonly returnStateText?: boolean;
}

export interface ExtractRequest<F extends Fields = Fields> {
  readonly fields: F;
  /** Text to read. Required and nonempty unless `images` are sent. Text answers are spans of this string. */
  readonly state?: string;
  readonly images?: readonly ImageInput[];
  readonly model?: string;
  /** ISO date (`YYYY-MM-DD`) that anchors dates written without a year. */
  readonly referenceDate?: string;
  readonly options?: ExtractOptions;
}

export type CharacterSpan = readonly [number, number];
export interface TextFieldAnswer {
  readonly type: 'text';
  readonly value: string | null;
  readonly guess?: string;
  readonly span?: CharacterSpan;
  readonly confidence?: number;
  readonly pNull?: number;
}
export interface NumberFieldAnswer {
  readonly type: 'number';
  readonly value: number | null;
  readonly guess?: number;
  readonly confidence?: number;
  readonly pNull?: number;
}
export interface DateFieldAnswer {
  readonly type: 'date';
  readonly value: string | null;
  readonly guess?: string;
  readonly confidence?: number;
  readonly pNull?: number;
}
export interface TimeFieldAnswer {
  readonly type: 'time';
  readonly value: string | null;
  readonly guess?: string;
  readonly confidence?: number;
  readonly pNull?: number;
}
export interface DateTimeFieldAnswer {
  readonly type: 'datetime';
  readonly value: string | null;
  readonly guess?: string;
  readonly confidence?: number;
  readonly pNull?: number;
}
export interface DurationFieldAnswer {
  readonly type: 'duration';
  readonly value: number | null;
  readonly guess?: number;
  readonly unit?: DurationUnit | string;
  readonly confidence?: number;
  readonly pNull?: number;
}
export interface ListFieldAnswer<V = string | number> {
  readonly type: 'list';
  readonly value: readonly V[];
  readonly spans?: readonly CharacterSpan[];
  readonly confidence?: number;
}
export interface EstimateFieldAnswer {
  readonly type: 'estimate';
  readonly value: number | string;
  readonly mean?: number | string;
  readonly median?: number | string;
  readonly p10?: number | string;
  readonly p90?: number | string;
  readonly pBelow?: number;
  readonly pAbove?: number;
  readonly quantiles?: readonly (number | string)[];
}
export interface ForecastFieldAnswer {
  readonly type: 'forecast';
  readonly value: readonly (number | string)[];
  readonly mean?: readonly (number | string)[];
  readonly median?: readonly (number | string)[];
  readonly p10?: readonly (number | string)[];
  readonly p90?: readonly (number | string)[];
  readonly pBelow?: number | readonly number[];
  readonly pAbove?: number | readonly number[];
  readonly quantiles?: readonly (readonly (number | string)[])[];
  readonly steps?: readonly EstimateFieldAnswer[];
}
export type FieldAnswer = TextFieldAnswer | NumberFieldAnswer | DateFieldAnswer | TimeFieldAnswer | DateTimeFieldAnswer
  | DurationFieldAnswer | ListFieldAnswer | EstimateFieldAnswer | ForecastFieldAnswer;
export type ListValueFor<I extends ListItemType> = I extends 'number' ? number : string;
export type FieldAnswerFor<F extends FieldSpec> =
  F extends TextFieldSpec ? TextFieldAnswer :
  F extends NumberFieldSpec ? NumberFieldAnswer :
  F extends DateFieldSpec ? DateFieldAnswer :
  F extends TimeFieldSpec ? TimeFieldAnswer :
  F extends DateTimeFieldSpec ? DateTimeFieldAnswer :
  F extends DurationFieldSpec ? DurationFieldAnswer :
  F extends ListFieldSpec<infer I> ? ListFieldAnswer<ListValueFor<I>> :
  F extends EstimateFieldSpec ? EstimateFieldAnswer : ForecastFieldAnswer;
export type FieldAnswers<F extends Fields> = { readonly [K in keyof F]: FieldAnswerFor<F[K]> };

export interface ExtractUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens?: number;
  readonly stateTokens?: number;
  readonly imageTokens?: number;
  readonly schemaTokens?: number;
  readonly passes?: number;
}
export interface ExtractResult<F extends Fields> {
  readonly model: string;
  readonly answers: FieldAnswers<F>;
  readonly truncated: boolean;
  readonly usage: ExtractUsage;
  readonly stateText?: string;
  readonly response: EvaluationResult<Questions>['response'];
}
export interface ExtractClient {
  extract<const F extends Fields>(request: ExtractRequest<F>, options?: RequestOptions): Promise<ExtractResult<F>>;
}
export interface ExtractAdapterContext {
  readonly baseURL: string;
  readonly model: string;
  readonly request: ExtractRequest;
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
  /** Used when extract() does not select a model. Defaults to `clairic` when extraction is enabled. */
  readonly defaultExtractModel?: string;
  readonly supportedQuestionTypes: readonly QuestionType[];
  readonly supportedFieldTypes?: readonly FieldType[];
  /** Explicit opt-in. Omission means text/JSON only; prepare must enforce model-specific support. */
  readonly supportsImages?: boolean;
  /** Explicit opt-in for `extract()`. Omission means the adapter answers questions only. */
  readonly supportsExtract?: boolean;
  /** Synchronous codec. Network I/O, cancellation, and retries belong to the client. */
  prepare(context: AdapterContext): PreparedRequest;
  /** Return a ProviderResponse envelope. The unknown boundary is deliberately runtime-validated. */
  decode(payload: unknown, context: AdapterContext): unknown;
  prepareExtract?(context: ExtractAdapterContext): PreparedRequest;
  decodeExtract?(payload: unknown, context: ExtractAdapterContext): unknown;
  /** Omit for standard Bearer authentication. Useful for future x-api-key protocols. */
  authenticate?(apiKey: string | null): HeadersInit;
}
export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type ApiKey = string | null | (() => string | null | Promise<string | null>);

/** Prepared HTTP exchange; contains no decision questions or answer decoding. */
export interface TransportRequest {
  readonly baseURL: string;
  readonly url: string;
  readonly body: string;
  readonly headers?: HeadersInit;
  readonly apiKey: ApiKey;
  readonly authenticate?: (apiKey: string | null) => HeadersInit;
}
export interface TransportOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  readonly maxRetryDelayMs: number;
  readonly maxResponseBytes: number;
  readonly headers: readonly HeadersInit[];
}
export interface TransportResponse {
  readonly payload: unknown;
  readonly status: number;
  readonly requestId?: string;
  readonly attempts: number;
}
export interface Transport {
  /** Must honor the total timeout, cancellation and retry budget for this exchange. */
  send(request: TransportRequest, options: TransportOptions): Promise<TransportResponse>;
}
export interface SystemOneOptions {
  /** Optional override for a proxy or compatible service. Built-in adapters supply their own URL. */
  readonly baseURL?: string;
  /** Explicit null supports an unauthenticated local server or same-origin application proxy. */
  readonly apiKey: ApiKey;
  /** Optional override of the adapter's default model. */
  readonly model?: string;
  /** Protocol behavior is supplied by an independently installed adapter package. */
  readonly adapter: SystemOneAdapter;
  /** Install transport-fetch or supply a custom transport. Core performs no network I/O. */
  readonly transport: Transport;
  readonly headers?: HeadersInit;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
  readonly maxRetryDelayMs?: number;
  readonly maxResponseBytes?: number;
}
