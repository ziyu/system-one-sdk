import { ResponseValidationError, ValidationError } from './errors.js';
import type {
  CharacterSpan, DurationUnit, EstimateFieldAnswer, ExtractOptions, ExtractRequest, ExtractResult,
  ExtractUsage, FieldAnswer, FieldAnswers, FieldSpec, FieldType, Fields, ForecastInterval,
  ImageInput, ListItemType,
} from './types.js';
import { assertJson, hasOwn, isRecord, responseRecord } from './validation.js';

type Fail = (path: string, message: string) => never;
const invalidInput: Fail = (path, message) => { throw new ValidationError(path, message); };
const invalidResponse: Fail = (path, message) => { throw new ResponseValidationError(path, message); };

export const FIELD_TYPES = Object.freeze([
  'text', 'number', 'date', 'time', 'datetime', 'duration', 'list', 'estimate', 'forecast',
] as const satisfies readonly FieldType[]);
export const LIST_ITEM_TYPES = Object.freeze(['text', 'number', 'date'] as const satisfies readonly ListItemType[]);
export const DURATION_UNITS = Object.freeze([
  'seconds', 'minutes', 'hours', 'days', 'weeks', 'months', 'years',
] as const satisfies readonly DurationUnit[]);
export const FORECAST_INTERVALS = Object.freeze([
  'step', 'minute', 'hour', 'day', 'week', 'month', 'quarter', 'year',
] as const satisfies readonly ForecastInterval[]);
export const EXTRACT_IMAGE_MEDIA_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp'] as const);
export const EXTRACT_MAX_IMAGES = 4;
export const EXTRACT_MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const EXTRACT_MAX_TOTAL_IMAGE_BYTES = 8 * 1024 * 1024;
export const EXTRACT_MAX_BODY_BYTES = 16 * 1024 * 1024;
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, fail: Fail): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(path, 'contains an unsupported field');
}
function nonemptyString(value: unknown, path: string, fail: Fail): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) fail(path, 'expected a nonempty string');
}
function booleanOf(value: unknown, path: string, fail: Fail): asserts value is boolean {
  if (typeof value !== 'boolean') fail(path, 'expected a boolean');
}
function finiteNumber(value: unknown, path: string, fail: Fail): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'expected a finite number');
}
function integerIn(value: unknown, min: number, max: number, path: string, fail: Fail): asserts value is number {
  finiteNumber(value, path, fail);
  if (!Number.isInteger(value) || value < min || value > max) fail(path, `expected an integer between ${min} and ${max}`);
}
function unitInterval(value: unknown, path: string, fail: Fail, exclusiveMin = false): asserts value is number {
  finiteNumber(value, path, fail);
  if (value > 1 || (exclusiveMin ? value <= 0 : value < 0)) {
    fail(path, exclusiveMin ? 'expected a number greater than 0 and at most 1' : 'expected a finite number between 0 and 1');
  }
}
function isoDate(value: unknown, path: string, fail: Fail): asserts value is string {
  if (typeof value !== 'string') fail(path, 'expected an ISO date (YYYY-MM-DD)');
  const match = ISO_DATE.exec(value);
  if (!match) fail(path, 'expected an ISO date (YYYY-MM-DD)');
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    fail(path, 'expected a real calendar date');
  }
}
function includes<T extends string>(value: unknown, allowed: readonly T[], path: string, fail: Fail): asserts value is T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(path, `expected ${allowed.join(', ')}`);
}

export function decodedBase64Bytes(base64: string): number {
  return base64.length / 4 * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
}
function imageParts(image: ImageInput, path: string): { mediaType: string; base64: string } {
  if (typeof image === 'string') {
    const prefix = /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(image);
    if (!prefix) invalidInput(path, 'expected an embedded image base64 data URL; remote URLs are unsupported');
    return { mediaType: prefix[1]!.toLowerCase(), base64: image.slice(prefix[0].length) };
  }
  return { mediaType: image.mediaType.toLowerCase(), base64: image.base64 };
}
function extractImages(value: unknown): void {
  if (!Array.isArray(value)) invalidInput('images', 'expected an array of embedded images');
  assertJson(value, 'images');
  if (value.length > EXTRACT_MAX_IMAGES) invalidInput('images', `accepts at most ${EXTRACT_MAX_IMAGES} images`);
  let totalBytes = 0;
  for (let index = 0; index < value.length; index++) {
    const image: unknown = value[index];
    const path = `images[${index}]`;
    let base64: unknown;
    let mediaType: string | undefined;
    if (typeof image === 'string') {
      const prefix = /^data:image\/[a-z0-9.+-]+;base64,/i.exec(image);
      if (!prefix) invalidInput(path, 'expected an embedded image base64 data URL; remote URLs are unsupported');
      mediaType = prefix[0].slice(5, prefix[0].indexOf(';')).toLowerCase();
      base64 = image.slice(prefix[0].length);
    } else if (isRecord(image)) {
      if (Reflect.ownKeys(image).some(key => key !== 'mediaType' && key !== 'base64')
        || !Object.getOwnPropertyDescriptor(image, 'mediaType')?.enumerable
        || !Object.getOwnPropertyDescriptor(image, 'base64')?.enumerable) {
        invalidInput(path, 'expected only enumerable mediaType and base64 fields');
      }
      if (typeof image.mediaType !== 'string' || !/^image\/[a-z0-9.+-]+$/i.test(image.mediaType)) {
        invalidInput(`${path}.mediaType`, 'expected an image MIME type');
      }
      mediaType = image.mediaType.toLowerCase();
      base64 = image.base64;
    } else invalidInput(path, 'expected a base64 data URL or an object containing mediaType and base64');
    if (typeof base64 !== 'string' || base64.length === 0 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
      invalidInput(path, 'expected nonempty, padded base64 image bytes');
    }
    if (!EXTRACT_IMAGE_MEDIA_TYPES.includes(mediaType as typeof EXTRACT_IMAGE_MEDIA_TYPES[number])) {
      invalidInput(path, 'accepts only PNG, JPEG or WebP images');
    }
    const bytes = decodedBase64Bytes(base64);
    if (bytes > EXTRACT_MAX_IMAGE_BYTES) invalidInput(path, 'image exceeds 4 MiB of decoded bytes');
    totalBytes += bytes;
    if (totalBytes > EXTRACT_MAX_TOTAL_IMAGE_BYTES) invalidInput('images', 'images exceed 8 MiB of total decoded bytes');
  }
}

const TEXT_KEYS = ['type', 'instructions', 'nullThreshold'] as const;
const NUMBER_KEYS = ['type', 'instructions', 'nullThreshold', 'unit', 'integer', 'decimals'] as const;
const DURATION_KEYS = ['type', 'instructions', 'nullThreshold', 'unit', 'integer', 'decimals'] as const;
const LIST_KEYS = ['type', 'instructions', 'items', 'unit', 'decimals'] as const;
const ESTIMATE_KEYS = ['type', 'instructions', 'nullThreshold', 'unit', 'min', 'max', 'step', 'scale'] as const;
const FORECAST_KEYS = ['type', 'instructions', 'nullThreshold', 'unit', 'min', 'max', 'step', 'scale', 'horizon', 'interval'] as const;

function bound(value: unknown, path: string): asserts value is number | string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalidInput(path, 'expected a finite number');
    return;
  }
  isoDate(value, path, invalidInput);
}
function stepOf(value: unknown, path: string): void {
  if (typeof value === 'string') {
    if (value !== 'month' && value !== 'year') invalidInput(path, 'expected a positive number, month, or year');
    return;
  }
  finiteNumber(value, path, invalidInput);
  if (value <= 0) invalidInput(path, 'expected a positive number, month, or year');
}
function fieldSpec(value: unknown, path: string): asserts value is FieldSpec {
  if (!isRecord(value)) invalidInput(path, 'expected an object');
  if (!hasOwn(value, 'type') || typeof value.type !== 'string' || !(FIELD_TYPES as readonly string[]).includes(value.type)) {
    invalidInput(`${path}.type`, `expected ${FIELD_TYPES.join(', ')}`);
  }
  const type = value.type as FieldType;
  if (value.instructions !== undefined) nonemptyString(value.instructions, `${path}.instructions`, invalidInput);
  if (value.nullThreshold !== undefined) unitInterval(value.nullThreshold, `${path}.nullThreshold`, invalidInput, true);
  if (type === 'text' || type === 'date' || type === 'time' || type === 'datetime') {
    onlyKeys(value, TEXT_KEYS, path, invalidInput);
    return;
  }
  if (type === 'number') {
    onlyKeys(value, NUMBER_KEYS, path, invalidInput);
    if (value.unit !== undefined) nonemptyString(value.unit, `${path}.unit`, invalidInput);
    if (value.integer !== undefined) booleanOf(value.integer, `${path}.integer`, invalidInput);
    if (value.decimals !== undefined) integerIn(value.decimals, 0, 6, `${path}.decimals`, invalidInput);
    return;
  }
  if (type === 'duration') {
    onlyKeys(value, DURATION_KEYS, path, invalidInput);
    if (value.unit !== undefined) includes(value.unit, DURATION_UNITS, `${path}.unit`, invalidInput);
    if (value.integer !== undefined) booleanOf(value.integer, `${path}.integer`, invalidInput);
    if (value.decimals !== undefined) integerIn(value.decimals, 0, 6, `${path}.decimals`, invalidInput);
    return;
  }
  if (type === 'list') {
    onlyKeys(value, LIST_KEYS, path, invalidInput);
    if (value.nullThreshold !== undefined) invalidInput(`${path}.nullThreshold`, 'is not defined for list fields');
    includes(value.items, LIST_ITEM_TYPES, `${path}.items`, invalidInput);
    if (value.unit !== undefined) nonemptyString(value.unit, `${path}.unit`, invalidInput);
    if (value.decimals !== undefined) {
      if (value.items !== 'number') invalidInput(`${path}.decimals`, 'is only valid for number lists');
      integerIn(value.decimals, 0, 6, `${path}.decimals`, invalidInput);
    }
    return;
  }
  const keys = type === 'estimate' ? ESTIMATE_KEYS : FORECAST_KEYS;
  onlyKeys(value, keys, path, invalidInput);
  if (!hasOwn(value, 'min')) invalidInput(`${path}.min`, 'is required');
  if (!hasOwn(value, 'max')) invalidInput(`${path}.max`, 'is required');
  bound(value.min, `${path}.min`);
  bound(value.max, `${path}.max`);
  if (typeof value.min !== typeof value.max) invalidInput(`${path}.max`, 'must use the same type as min');
  if (typeof value.min === 'number' && typeof value.max === 'number' && value.min >= value.max) {
    invalidInput(`${path}.max`, 'must be greater than min');
  }
  if (typeof value.min === 'string' && typeof value.max === 'string' && value.min >= value.max) {
    invalidInput(`${path}.max`, 'must be later than min');
  }
  if (value.unit !== undefined) nonemptyString(value.unit, `${path}.unit`, invalidInput);
  if (value.step !== undefined) stepOf(value.step, `${path}.step`);
  if (value.scale !== undefined) includes(value.scale, ['linear', 'log'], `${path}.scale`, invalidInput);
  if (type === 'forecast') {
    if (value.horizon !== undefined) integerIn(value.horizon, 1, 64, `${path}.horizon`, invalidInput);
    if (value.interval !== undefined) includes(value.interval, FORECAST_INTERVALS, `${path}.interval`, invalidInput);
  }
}

function optionsOf(value: unknown): asserts value is ExtractOptions {
  if (!isRecord(value)) invalidInput('options', 'expected an object');
  onlyKeys(value, ['nullThreshold', 'includeQuantiles', 'returnStateText'], 'options', invalidInput);
  if (value.nullThreshold !== undefined) unitInterval(value.nullThreshold, 'options.nullThreshold', invalidInput, true);
  if (value.includeQuantiles !== undefined) booleanOf(value.includeQuantiles, 'options.includeQuantiles', invalidInput);
  if (value.returnStateText !== undefined) booleanOf(value.returnStateText, 'options.returnStateText', invalidInput);
}

export function snapshotExtractRequest<F extends Fields>(request: ExtractRequest<F>): ExtractRequest<F> {
  if (!isRecord(request)) invalidInput('request', 'expected an object');
  if (Object.getOwnPropertySymbols(request).length) invalidInput('request', 'symbol properties are unsupported');
  for (const key of Object.getOwnPropertyNames(request)) {
    if (!('value' in Object.getOwnPropertyDescriptor(request, key)!)) invalidInput('request', 'accessor properties are unsupported');
  }
  onlyKeys(request, ['state', 'fields', 'images', 'model', 'referenceDate', 'options'], 'request', invalidInput);
  if (!hasOwn(request, 'fields') || !isRecord(request.fields) || Object.keys(request.fields).length === 0) {
    invalidInput('fields', 'expected at least one named field');
  }
  assertJson(request.fields, 'fields');
  for (const [id, value] of Object.entries(request.fields)) {
    if (!FIELD_NAME.test(id)) invalidInput('fields', 'field names must match [A-Za-z_][A-Za-z0-9_.-]{0,63}');
    fieldSpec(value, `fields.${id}`);
  }
  const images = request.images;
  if (images !== undefined) extractImages(images);
  const hasImages = Array.isArray(images) && images.length > 0;
  if (request.state === undefined) {
    if (!hasImages) invalidInput('state', 'expected a nonempty string unless images are sent');
  } else if (typeof request.state !== 'string') {
    invalidInput('state', 'expected a string');
  } else if (request.state.trim().length === 0 && !hasImages) {
    invalidInput('state', 'expected a nonempty string unless images are sent');
  }
  if (request.model !== undefined) nonemptyString(request.model, 'model', invalidInput);
  if (request.referenceDate !== undefined) isoDate(request.referenceDate, 'referenceDate', invalidInput);
  if (request.options !== undefined) optionsOf(request.options);
  return JSON.parse(JSON.stringify({
    fields: request.fields,
    ...(request.state === undefined ? {} : { state: request.state }),
    ...(request.images === undefined ? {} : { images: request.images }),
    ...(request.model === undefined ? {} : { model: request.model }),
    ...(request.referenceDate === undefined ? {} : { referenceDate: request.referenceDate }),
    ...(request.options === undefined ? {} : { options: request.options }),
  })) as ExtractRequest<F>;
}

function encodeField(spec: FieldSpec, defaultNullThreshold: number | undefined): Record<string, unknown> {
  const field: Record<string, unknown> = { type: spec.type };
  if ('instructions' in spec && spec.instructions !== undefined) field.instructions = spec.instructions;
  if ('unit' in spec && spec.unit !== undefined) field.unit = spec.unit;
  if ('integer' in spec && spec.integer !== undefined) field.integer = spec.integer;
  if ('decimals' in spec && spec.decimals !== undefined) field.decimals = spec.decimals;
  if (spec.type === 'list') field.items = spec.items;
  if (spec.type === 'estimate' || spec.type === 'forecast') {
    field.min = spec.min;
    field.max = spec.max;
    if (spec.step !== undefined) field.step = spec.step;
    if (spec.scale !== undefined) field.scale = spec.scale;
  }
  if (spec.type === 'forecast') {
    if (spec.horizon !== undefined) field.horizon = spec.horizon;
    if (spec.interval !== undefined) field.interval = spec.interval;
  }
  const threshold = spec.type === 'list' ? undefined : spec.nullThreshold ?? defaultNullThreshold;
  if (threshold !== undefined) field.null_threshold = threshold;
  return field;
}

function wireImage(image: ImageInput): string | { content_type: string; base64: string } {
  if (typeof image === 'string') return image;
  const { mediaType, base64 } = imageParts(image, 'images');
  return { content_type: mediaType, base64 };
}

/** Clairic wire body. Adapters send this JSON; they do not invent extra envelopes. */
export function encodeExtractBody(model: string, request: ExtractRequest): Record<string, unknown> {
  const defaultNullThreshold = request.options?.nullThreshold;
  const options: Record<string, unknown> = {};
  if (request.options?.includeQuantiles !== undefined) options.include_quantiles = request.options.includeQuantiles;
  if (request.options?.returnStateText !== undefined) options.return_state_text = request.options.returnStateText;
  return {
    model,
    ...(request.state === undefined ? {} : { state: request.state }),
    fields: Object.fromEntries(Object.entries(request.fields).map(([id, spec]) => [id, encodeField(spec, defaultNullThreshold)])),
    ...(request.images === undefined ? {} : { images: request.images.map(wireImage) }),
    ...(request.referenceDate === undefined ? {} : { reference_date: request.referenceDate }),
    ...(Object.keys(options).length === 0 ? {} : { options }),
  };
}

function pick(record: Record<string, unknown>, snake: string, camel: string): unknown {
  return hasOwn(record, snake) ? record[snake] : record[camel];
}
function optionalFinite(value: unknown, path: string): number {
  finiteNumber(value, path, invalidResponse);
  return value;
}
function optionalUnitInterval(value: unknown, path: string): number {
  unitInterval(value, path, invalidResponse);
  return value;
}
function optionalString(value: unknown, path: string): string {
  if (typeof value !== 'string') invalidResponse(path, 'expected a string');
  return value;
}
function spanOf(value: unknown, path: string): CharacterSpan {
  if (!Array.isArray(value) || value.length !== 2) invalidResponse(path, 'expected a [start, end] character span');
  integerIn(value[0], 0, Number.MAX_SAFE_INTEGER, `${path}[0]`, invalidResponse);
  integerIn(value[1], 0, Number.MAX_SAFE_INTEGER, `${path}[1]`, invalidResponse);
  if (value[1] < value[0]) invalidResponse(path, 'end must be greater than or equal to start');
  return [value[0], value[1]];
}
function tokenCount(value: unknown, path: string): number {
  const count = optionalFinite(value, path);
  if (!Number.isSafeInteger(count) || count < 0) invalidResponse(path, 'expected a safe non-negative integer');
  return count;
}
function scalarOrNull(value: unknown, kind: 'string' | 'number', path: string): string | number | null {
  if (value === null) return null;
  if (kind === 'string') {
    if (typeof value !== 'string') invalidResponse(path, 'expected a string or null');
    return value;
  }
  finiteNumber(value, path, invalidResponse);
  return value;
}
function quantity(value: unknown, path: string): number | string {
  if (typeof value === 'number' && Number.isFinite(value) || typeof value === 'string') return value;
  invalidResponse(path, 'expected a finite number or string');
}
function quantityArray(value: unknown, path: string): readonly (number | string)[] {
  if (!Array.isArray(value)) invalidResponse(path, 'expected an array');
  return value.map((entry, index) => quantity(entry, `${path}[${index}]`));
}

function estimateAnswer(answer: Record<string, unknown>, path: string): EstimateFieldAnswer {
  const result: EstimateFieldAnswer = {
    type: 'estimate',
    value: quantity(hasOwn(answer, 'value') ? answer.value : invalidResponse(`${path}.value`, 'is required'), `${path}.value`),
  };
  const mean = pick(answer, 'mean', 'mean');
  const median = pick(answer, 'median', 'median');
  const p10 = pick(answer, 'p10', 'p10');
  const p90 = pick(answer, 'p90', 'p90');
  const pBelow = pick(answer, 'p_below', 'pBelow');
  const pAbove = pick(answer, 'p_above', 'pAbove');
  const quantiles = pick(answer, 'quantiles', 'quantiles');
  return {
    ...result,
    ...(mean === undefined ? {} : { mean: quantity(mean, `${path}.mean`) }),
    ...(median === undefined ? {} : { median: quantity(median, `${path}.median`) }),
    ...(p10 === undefined ? {} : { p10: quantity(p10, `${path}.p10`) }),
    ...(p90 === undefined ? {} : { p90: quantity(p90, `${path}.p90`) }),
    ...(pBelow === undefined ? {} : { pBelow: optionalUnitInterval(pBelow, `${path}.pBelow`) }),
    ...(pAbove === undefined ? {} : { pAbove: optionalUnitInterval(pAbove, `${path}.pAbove`) }),
    ...(quantiles === undefined ? {} : { quantiles: quantityArray(quantiles, `${path}.quantiles`) }),
  };
}

function fieldAnswer(spec: FieldSpec, raw: unknown, path: string): FieldAnswer {
  const answer = responseRecord(raw, path);
  if (answer.type !== spec.type) invalidResponse(`${path}.type`, 'does not match its field');
  if (!hasOwn(answer, 'value')) invalidResponse(`${path}.value`, 'is required');
  const confidenceRaw = pick(answer, 'confidence', 'confidence');
  const pNullRaw = pick(answer, 'p_null', 'pNull');
  const confidence = confidenceRaw === undefined ? undefined : optionalUnitInterval(confidenceRaw, `${path}.confidence`);
  const pNull = pNullRaw === undefined ? undefined : optionalUnitInterval(pNullRaw, `${path}.pNull`);
  if (spec.type === 'text') {
    const span = pick(answer, 'span', 'span');
    const guess = pick(answer, 'guess', 'guess');
    return {
      type: 'text', value: scalarOrNull(answer.value, 'string', `${path}.value`) as string | null,
      ...(guess === undefined ? {} : { guess: optionalString(guess, `${path}.guess`) }),
      ...(span === undefined ? {} : { span: spanOf(span, `${path}.span`) }),
      ...(confidence === undefined ? {} : { confidence }),
      ...(pNull === undefined ? {} : { pNull }),
    };
  }
  if (spec.type === 'number' || spec.type === 'duration') {
    const guess = pick(answer, 'guess', 'guess');
    const unit = pick(answer, 'unit', 'unit');
    const common = {
      value: scalarOrNull(answer.value, 'number', `${path}.value`) as number | null,
      ...(guess === undefined ? {} : { guess: optionalFinite(guess, `${path}.guess`) }),
      ...(confidence === undefined ? {} : { confidence }),
      ...(pNull === undefined ? {} : { pNull }),
    };
    return spec.type === 'number' ? { type: 'number', ...common }
      : { type: 'duration', ...common, ...(unit === undefined ? {} : { unit: optionalString(unit, `${path}.unit`) }) };
  }
  if (spec.type === 'date' || spec.type === 'time' || spec.type === 'datetime') {
    const guess = pick(answer, 'guess', 'guess');
    const common = {
      value: scalarOrNull(answer.value, 'string', `${path}.value`) as string | null,
      ...(guess === undefined ? {} : { guess: optionalString(guess, `${path}.guess`) }),
      ...(confidence === undefined ? {} : { confidence }),
      ...(pNull === undefined ? {} : { pNull }),
    };
    return { type: spec.type, ...common };
  }
  if (spec.type === 'list') {
    if (!Array.isArray(answer.value)) invalidResponse(`${path}.value`, 'expected an array');
    const expected = spec.items === 'number' ? 'number' : 'string';
    const value = answer.value.map((entry, index) => {
      if (expected === 'number') {
        finiteNumber(entry, `${path}.value[${index}]`, invalidResponse);
        return entry;
      }
      if (typeof entry !== 'string') invalidResponse(`${path}.value[${index}]`, 'expected a string');
      return entry;
    });
    const spans = pick(answer, 'spans', 'spans');
    return {
      type: 'list', value,
      ...(spans === undefined ? {} : {
        spans: Array.isArray(spans) ? spans.map((entry, index) => spanOf(entry, `${path}.spans[${index}]`))
          : invalidResponse(`${path}.spans`, 'expected an array of character spans'),
      }),
      ...(confidence === undefined ? {} : { confidence }),
    };
  }
  if (spec.type === 'estimate') return estimateAnswer(answer, path);
  if (!Array.isArray(answer.value)) invalidResponse(`${path}.value`, 'expected an array');
  const steps = pick(answer, 'steps', 'steps');
  const pBelow = pick(answer, 'p_below', 'pBelow');
  const pAbove = pick(answer, 'p_above', 'pAbove');
  const below = pBelow === undefined ? undefined : Array.isArray(pBelow)
    ? pBelow.map((entry, index) => { unitInterval(entry, `${path}.pBelow[${index}]`, invalidResponse); return entry; })
    : optionalUnitInterval(pBelow, `${path}.pBelow`);
  const above = pAbove === undefined ? undefined : Array.isArray(pAbove)
    ? pAbove.map((entry, index) => { unitInterval(entry, `${path}.pAbove[${index}]`, invalidResponse); return entry; })
    : optionalUnitInterval(pAbove, `${path}.pAbove`);
  const quantiles = pick(answer, 'quantiles', 'quantiles');
  return {
    type: 'forecast',
    value: quantityArray(answer.value, `${path}.value`),
    ...(pick(answer, 'mean', 'mean') === undefined ? {} : { mean: quantityArray(pick(answer, 'mean', 'mean'), `${path}.mean`) }),
    ...(pick(answer, 'median', 'median') === undefined ? {} : { median: quantityArray(pick(answer, 'median', 'median'), `${path}.median`) }),
    ...(pick(answer, 'p10', 'p10') === undefined ? {} : { p10: quantityArray(pick(answer, 'p10', 'p10'), `${path}.p10`) }),
    ...(pick(answer, 'p90', 'p90') === undefined ? {} : { p90: quantityArray(pick(answer, 'p90', 'p90'), `${path}.p90`) }),
    ...(below === undefined ? {} : { pBelow: below }),
    ...(above === undefined ? {} : { pAbove: above }),
    ...(quantiles === undefined ? {} : {
      quantiles: Array.isArray(quantiles)
        ? quantiles.map((entry, index) => quantityArray(entry, `${path}.quantiles[${index}]`))
        : invalidResponse(`${path}.quantiles`, 'expected an array of quantile series'),
    }),
    ...(steps === undefined ? {} : {
      steps: Array.isArray(steps)
        ? steps.map((entry, index) => {
          const step = responseRecord(entry, `${path}.steps[${index}]`);
          return estimateAnswer({ ...step, type: step.type ?? 'estimate' }, `${path}.steps[${index}]`);
        })
        : invalidResponse(`${path}.steps`, 'expected an array of estimates'),
    }),
  };
}

export function validateExtractResponse<F extends Fields>(
  payload: unknown, fields: F, requestedModel: string,
): Omit<ExtractResult<F>, 'response'> {
  const root = responseRecord(payload, 'response');
  const source = responseRecord(root.answers, 'answers');
  const keys = Object.keys(fields);
  if (Object.keys(source).length !== keys.length || keys.some(key => !hasOwn(source, key))) {
    invalidResponse('answers', 'keys must match the request exactly');
  }
  const answers = Object.fromEntries(keys.map(id => [id, fieldAnswer(fields[id]!, source[id], `answers.${id}`)])) as FieldAnswers<F>;
  const model = root.model === undefined ? requestedModel : root.model;
  nonemptyString(model, 'model', invalidResponse);
  if (typeof root.truncated !== 'boolean') invalidResponse('truncated', 'expected a boolean');
  const usageRaw = responseRecord(root.usage, 'usage');
  const inputTokens = tokenCount(pick(usageRaw, 'input_tokens', 'inputTokens'), 'usage.inputTokens');
  const outputTokens = tokenCount(pick(usageRaw, 'output_tokens', 'outputTokens'), 'usage.outputTokens');
  const total = inputTokens + outputTokens;
  if (!Number.isSafeInteger(total)) invalidResponse('usage.totalTokens', 'total exceeds the safe integer range');
  const stateTokens = pick(usageRaw, 'state_tokens', 'stateTokens');
  const imageTokens = pick(usageRaw, 'image_tokens', 'imageTokens');
  const schemaTokens = pick(usageRaw, 'schema_tokens', 'schemaTokens');
  const passes = pick(usageRaw, 'passes', 'passes');
  const usage: ExtractUsage = {
    inputTokens, outputTokens, totalTokens: total,
    ...(stateTokens === undefined ? {} : { stateTokens: tokenCount(stateTokens, 'usage.stateTokens') }),
    ...(imageTokens === undefined ? {} : { imageTokens: tokenCount(imageTokens, 'usage.imageTokens') }),
    ...(schemaTokens === undefined ? {} : { schemaTokens: tokenCount(schemaTokens, 'usage.schemaTokens') }),
    ...(passes === undefined ? {} : { passes: tokenCount(passes, 'usage.passes') }),
  };
  const stateText = pick(root, 'state_text', 'stateText');
  return {
    model, answers, truncated: root.truncated, usage,
    ...(stateText === undefined ? {} : { stateText: optionalString(stateText, 'stateText') }),
  };
}

export function assertExtractBodySize(body: string): void {
  if (new TextEncoder().encode(body).length > EXTRACT_MAX_BODY_BYTES) {
    throw new ValidationError('request', 'extract request body exceeds 16 MiB');
  }
}
