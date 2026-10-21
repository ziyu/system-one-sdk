import type {
  DateFieldSpec, DateTimeFieldSpec, DurationFieldSpec, EstimateFieldSpec, Fields, ForecastFieldSpec,
  ListFieldSpec, ListItemType, NumberFieldSpec, TextFieldSpec, TimeFieldSpec,
} from './types.js';

export function textField(spec: Omit<TextFieldSpec, 'type'> = {}): TextFieldSpec {
  return {
    type: 'text',
    ...(spec.instructions === undefined ? {} : { instructions: spec.instructions }),
    ...(spec.nullThreshold === undefined ? {} : { nullThreshold: spec.nullThreshold }),
  };
}
export function numberField(spec: Omit<NumberFieldSpec, 'type'> = {}): NumberFieldSpec {
  return {
    type: 'number',
    ...(spec.instructions === undefined ? {} : { instructions: spec.instructions }),
    ...(spec.nullThreshold === undefined ? {} : { nullThreshold: spec.nullThreshold }),
    ...(spec.unit === undefined ? {} : { unit: spec.unit }),
    ...(spec.integer === undefined ? {} : { integer: spec.integer }),
    ...(spec.decimals === undefined ? {} : { decimals: spec.decimals }),
  };
}
export function dateField(spec: Omit<DateFieldSpec, 'type'> = {}): DateFieldSpec {
  return {
    type: 'date',
    ...(spec.instructions === undefined ? {} : { instructions: spec.instructions }),
    ...(spec.nullThreshold === undefined ? {} : { nullThreshold: spec.nullThreshold }),
  };
}
export function timeField(spec: Omit<TimeFieldSpec, 'type'> = {}): TimeFieldSpec {
  return {
    type: 'time',
    ...(spec.instructions === undefined ? {} : { instructions: spec.instructions }),
    ...(spec.nullThreshold === undefined ? {} : { nullThreshold: spec.nullThreshold }),
  };
}
export function dateTimeField(spec: Omit<DateTimeFieldSpec, 'type'> = {}): DateTimeFieldSpec {
  return {
    type: 'datetime',
    ...(spec.instructions === undefined ? {} : { instructions: spec.instructions }),
    ...(spec.nullThreshold === undefined ? {} : { nullThreshold: spec.nullThreshold }),
  };
}
export function durationField(spec: Omit<DurationFieldSpec, 'type'> = {}): DurationFieldSpec {
  return {
    type: 'duration',
    ...(spec.instructions === undefined ? {} : { instructions: spec.instructions }),
    ...(spec.nullThreshold === undefined ? {} : { nullThreshold: spec.nullThreshold }),
    ...(spec.unit === undefined ? {} : { unit: spec.unit }),
    ...(spec.integer === undefined ? {} : { integer: spec.integer }),
    ...(spec.decimals === undefined ? {} : { decimals: spec.decimals }),
  };
}
export function listField<const I extends ListItemType>(spec: Omit<ListFieldSpec<I>, 'type'> & { readonly items: I }): ListFieldSpec<I> {
  return {
    type: 'list',
    items: spec.items,
    ...(spec.instructions === undefined ? {} : { instructions: spec.instructions }),
    ...(spec.unit === undefined ? {} : { unit: spec.unit }),
    ...(spec.decimals === undefined ? {} : { decimals: spec.decimals }),
  };
}
export function estimateField(spec: Omit<EstimateFieldSpec, 'type'>): EstimateFieldSpec {
  return {
    type: 'estimate',
    min: spec.min,
    max: spec.max,
    ...(spec.instructions === undefined ? {} : { instructions: spec.instructions }),
    ...(spec.nullThreshold === undefined ? {} : { nullThreshold: spec.nullThreshold }),
    ...(spec.unit === undefined ? {} : { unit: spec.unit }),
    ...(spec.step === undefined ? {} : { step: spec.step }),
    ...(spec.scale === undefined ? {} : { scale: spec.scale }),
  };
}
export function forecastField(spec: Omit<ForecastFieldSpec, 'type'>): ForecastFieldSpec {
  return {
    type: 'forecast',
    min: spec.min,
    max: spec.max,
    ...(spec.instructions === undefined ? {} : { instructions: spec.instructions }),
    ...(spec.nullThreshold === undefined ? {} : { nullThreshold: spec.nullThreshold }),
    ...(spec.unit === undefined ? {} : { unit: spec.unit }),
    ...(spec.step === undefined ? {} : { step: spec.step }),
    ...(spec.scale === undefined ? {} : { scale: spec.scale }),
    ...(spec.horizon === undefined ? {} : { horizon: spec.horizon }),
    ...(spec.interval === undefined ? {} : { interval: spec.interval }),
  };
}
/** Preserves literal field IDs and list item types when definitions are shared between calls. */
export function defineFields<const F extends Fields>(fields: F): F { return fields; }
