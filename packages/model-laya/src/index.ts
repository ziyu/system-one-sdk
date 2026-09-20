// Rendering and calibration are adapted from Convai Innovations' Apache-2.0
// Laya rl_common.py/rl_agent_api.py, revision 1c5edc17a7acd8701df6fc341c0d179f1c62c982.
// Modified for the System One TypeScript contracts, validation and warnings.
// See this package's LICENSE for attribution and license terms.
import { ConfigurationError, ResponseValidationError, UnsupportedFeatureError, ValidationError } from '@system-one-ai/core';
import type { Answer, Description, JsonValue, Question } from '@system-one-ai/core';

/** Produced by scripts/laya/export.py; all asset paths are relative to laya.json. */
export interface LayaManifest {
  readonly format: 'system-one-laya-onnx-v1';
  readonly model: string;
  readonly revision: string;
  readonly modelFile: string;
  readonly externalData?: readonly { readonly path: string; readonly data: string }[];
  readonly tokenizer: string;
  readonly maxLength: number;
  readonly headMaxLength: number;
  readonly temperature: readonly [number, number, number];
  readonly temperatureByOptions?: Readonly<Record<string, number>>;
  readonly tokenIds: { readonly cls: number; readonly sep: number; readonly pad: number; readonly mask: number };
  readonly maskToken: string;
}

export interface LayaTokenizer {
  encode(text: string, options: { readonly add_special_tokens: false }): readonly number[] | Promise<readonly number[]>;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function relativePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !/^[/.]|[\\?#:]|(?:^|\/)\.\.(?:\/|$)/.test(value);
}

export function parseLayaManifest(value: unknown): LayaManifest {
  const fail = (): never => { throw new ConfigurationError('Invalid Laya manifest. Export the complete model with scripts/laya/export.py.'); };
  if (!record(value) || value.format !== 'system-one-laya-onnx-v1') return fail();
  if (typeof value.model !== 'string' || !value.model.trim() || typeof value.revision !== 'string' || !value.revision.trim()) return fail();
  if (!relativePath(value.modelFile) || !value.modelFile.endsWith('.onnx') || !relativePath(value.tokenizer)) return fail();
  if (!Number.isSafeInteger(value.maxLength) || (value.maxLength as number) < 16 || (value.maxLength as number) > 8192) return fail();
  if (!Number.isSafeInteger(value.headMaxLength) || (value.headMaxLength as number) < 16 || (value.headMaxLength as number) >= (value.maxLength as number)) return fail();
  const positive = (item: unknown): boolean => typeof item === 'number' && Number.isFinite(item) && item > 0;
  if (!Array.isArray(value.temperature) || value.temperature.length !== 3 || !value.temperature.every(positive)) return fail();
  if (value.temperatureByOptions !== undefined && (!record(value.temperatureByOptions) || !Object.values(value.temperatureByOptions).every(positive))) return fail();
  const tokenIds = value.tokenIds;
  if (!record(tokenIds) || !['cls', 'sep', 'pad', 'mask'].every(key => Number.isSafeInteger(tokenIds[key]) && (tokenIds[key] as number) >= 0)) return fail();
  if (typeof value.maskToken !== 'string' || !value.maskToken) return fail();
  if (value.externalData !== undefined && (!Array.isArray(value.externalData) || !value.externalData.every(item => record(item) && relativePath(item.path) && relativePath(item.data)))) return fail();
  return value as unknown as LayaManifest;
}

// Match the saved Python API's JSON separators and ensure_ascii behavior. The
// local transport has already taken a JSON snapshot, so values are JSON only.
function json(value: JsonValue, ascii: boolean): string {
  if (Array.isArray(value)) return `[${value.map(item => json(item, ascii)).join(', ')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).map(([key, item]) => `${json(key, ascii)}: ${json(item, ascii)}`).join(', ')}}`;
  if (typeof value === 'number' && !Number.isInteger(value) && Math.abs(value) < 0.0001 && value !== 0) {
    return value.toExponential().replace(/e([+-])(\d)$/, 'e$10$2');
  }
  const text = JSON.stringify(value);
  return ascii ? text.replace(/[\u007f-\uffff]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`) : text;
}

function reprString(value: string): string {
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  const escaped = Array.from(value, character => {
    if (character === quote || character === '\\') return `\\${character}`;
    if (character === '\n') return '\\n';
    if (character === '\r') return '\\r';
    if (character === '\t') return '\\t';
    const code = character.codePointAt(0)!;
    // Python repr escapes nonprintable Unicode, including format characters,
    // private-use code points and separators other than the ordinary space.
    if (code !== 32 && /[\p{C}\p{Z}]/u.test(character)) {
      const prefix = code < 256 ? 'x' : code <= 0xffff ? 'u' : 'U';
      const width = code < 256 ? 2 : code <= 0xffff ? 4 : 8;
      return `\\${prefix}${code.toString(16).padStart(width, '0')}`;
    }
    return character;
  }).join('');
  return `${quote}${escaped}${quote}`;
}

function repr(value: JsonValue): string {
  if (value === null) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'string') return reprString(value);
  if (Array.isArray(value)) return `[${value.map(repr).join(', ')}]`;
  if (typeof value === 'object') return `{${Object.entries(value).map(([key, item]) => `${reprString(key)}: ${repr(item)}`).join(', ')}}`;
  return json(value, false);
}

function description(value: Description): string { return typeof value === 'string' ? value : repr(value); }
function truthy(value: Description | undefined): boolean {
  return value !== undefined && value !== null && (typeof value === 'string' ? value.length > 0 : Object.keys(value).length > 0);
}

export interface LayaRow {
  readonly id: string;
  readonly question: Question;
  readonly ids: readonly number[];
  readonly markers: readonly number[];
  readonly qtype: 0 | 1 | 2;
  readonly warnings: readonly JsonValue[];
}

/** Port of the pinned checkpoint's build_sequence(), including mask escaping. */
export async function prepareLayaRow(id: string, state: JsonValue, question: Question, tokenizer: LayaTokenizer, manifest: LayaManifest): Promise<LayaRow> {
  const type = question.type === 'boolean' ? 'noul' : question.type;
  const qtype = type === 'choice' ? 0 : type === 'score' ? 1 : 2;
  let options: string[];
  if (question.type === 'choice') options = Object.entries(question.criteria).map(([key, value]) => truthy(value) ? `${key}: ${description(value)}` : key);
  else if (question.type === 'score') options = question.criteria.map((value, index) => `level ${index}: ${description(value)}`);
  else {
    const criteria = question.criteria;
    for (const value of [criteria?.false, criteria?.true]) {
      if (value !== undefined && value !== null && typeof value !== 'string') throw new UnsupportedFeatureError('Laya boolean criteria must be strings or null, as required by its Python API.');
    }
    options = [`false: ${criteria?.false || 'no, the statement does not hold'}`, `true: ${criteria?.true || 'yes, the statement holds'}`];
  }
  const clean = (text: string): string => text.split(manifest.maskToken).join(' ');
  const encode = async (text: string): Promise<number[]> => {
    const tokens = await tokenizer.encode(text, { add_special_tokens: false });
    if (!Array.isArray(tokens) || !tokens.every(token => Number.isSafeInteger(token) && token >= 0)) throw new ConfigurationError('Laya tokenizer.encode must return nonnegative integer token IDs.');
    return [...tokens];
  };
  const instructions = typeof question.instructions === 'string' ? question.instructions : json(question.instructions, true);
  const originalHead = await encode(`${type} question: ${clean(instructions)}`);
  const originalOptions: number[][] = [];
  for (const option of options) originalOptions.push(await encode(` ${clean(option)}`));
  let optionIds = originalOptions.map(tokens => [manifest.tokenIds.mask, ...tokens.slice(0, 48)]);
  let budget = manifest.headMaxLength - optionIds.reduce((sum, tokens) => sum + tokens.length, 0);
  if (budget < 16) {
    const per = Math.max(4, Math.floor((manifest.headMaxLength - 16) / Math.max(1, optionIds.length)));
    optionIds = optionIds.map(tokens => tokens.slice(0, per));
    budget = manifest.headMaxLength - optionIds.reduce((sum, tokens) => sum + tokens.length, 0);
  }
  const head = originalHead.slice(0, Math.max(8, budget));
  let ids = [manifest.tokenIds.cls, ...head, manifest.tokenIds.sep];
  const markers: number[] = [];
  for (const tokens of optionIds) { markers.push(ids.length); ids.push(...tokens); }
  ids.push(manifest.tokenIds.sep);
  const room = Math.max(0, manifest.maxLength - ids.length - 1);
  const stateTokens = await encode(clean(typeof state === 'string' ? state : json(state, false)));
  ids = [...ids, ...stateTokens.slice(0, room), manifest.tokenIds.sep].slice(0, manifest.maxLength);
  if (markers.some(marker => marker >= manifest.maxLength)) throw new ValidationError(`questions.${id}.criteria`, 'Laya option markers do not fit in the exported model context; reduce the option count.');
  const warnings: JsonValue[] = [];
  if (head.length < originalHead.length) warnings.push({ code: 'laya_instructions_truncated', question: id });
  if (optionIds.some((tokens, index) => tokens.length - 1 < originalOptions[index]!.length)) warnings.push({ code: 'laya_options_truncated', question: id });
  if (stateTokens.length > room) warnings.push({ code: 'laya_state_truncated', question: id, tokensKept: room, tokensOriginal: stateTokens.length });
  return { id, question, ids, markers, qtype, warnings };
}

export function layaSoftmax(logits: readonly number[], temperature = 1): number[] {
  if (!logits.length || logits.some(value => !Number.isFinite(value))) throw new ResponseValidationError('logits', 'Laya returned non-finite or empty logits.');
  // Subtract before division to avoid overflow with small positive temperatures.
  const maximum = Math.max(...logits);
  const values = logits.map(value => Math.exp((value - maximum) / temperature));
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.map(value => value / total);
}

export function layaAnswer(row: LayaRow, logits: readonly number[], manifest: LayaManifest): Answer {
  const k = row.markers.length;
  if (logits.length !== k) throw new ResponseValidationError('logits', 'Laya output does not cover every option.');
  const bucket = k <= 2 ? '2' : k <= 5 ? '3-5' : k <= 10 ? '6-10' : '11+';
  const type = row.qtype === 2 ? 'noul' : row.question.type;
  const temperature = manifest.temperatureByOptions?.[`${type}:${bucket}`] ?? manifest.temperature[row.qtype];
  const probabilities = layaSoftmax(logits, temperature);
  // Preserve unrounded probabilities. Core can validate their sum exactly and
  // consumers may round for presentation without losing model information.
  if (row.question.type === 'boolean') return { type: 'boolean', probability: probabilities[1]! };
  const entropy = -probabilities.reduce((sum, probability) => sum + probability * Math.log(Math.max(probability, 1e-12)), 0);
  const confidence = k < 2 ? 1 : Math.max(0, Math.min(1, 1 - entropy / Math.log(k)));
  if (row.question.type === 'choice') {
    const keys = Object.keys(row.question.criteria);
    const best = probabilities.reduce((winner, value, index) => value > probabilities[winner]! ? index : winner, 0);
    return { type: 'choice', choice: keys[best]!, probabilities: Object.fromEntries(keys.map((key, index) => [key, probabilities[index]!])), confidence };
  }
  return {
    type: 'score', score: probabilities.reduce((sum, probability, index) => sum + index * probability, 0),
    probabilities: Object.fromEntries(probabilities.map((probability, index) => [String(index), probability])), confidence,
    legend: Object.fromEntries(row.question.criteria.map((criterion, index) => [String(index), criterion])),
  };
}
