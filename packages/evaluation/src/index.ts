import { ConfigurationError, SystemOneError } from '@system-one-ai/core';
import type { Answer, EvaluateRequest, EvaluationClient, JsonValue, Question, Questions, RequestOptions, State } from '@system-one-ai/core';

export type EvaluationGold = string | boolean | number;

export interface EvaluationCase<Q extends Questions = Questions> {
  readonly id: string;
  readonly request: EvaluateRequest<Q>;
  /** The one question in request.questions scored by this case. */
  readonly questionId: Extract<keyof Q, string> | string;
  readonly gold: EvaluationGold;
}

export interface EvaluationVariant {
  readonly id: string;
  readonly transformState?: (state: State, item: EvaluationCase) => State;
}

export interface EvaluationRunOptions {
  readonly variants?: readonly EvaluationVariant[];
  readonly requestOptions?: RequestOptions;
}

export interface EvaluationRow {
  readonly caseId: string;
  readonly variant: string;
  readonly task: Question['type'];
  readonly labels: readonly string[];
  readonly gold: number;
  readonly prediction: number | null;
  readonly probabilities: readonly number[] | null;
  readonly score: number | null;
  readonly ok: boolean;
  readonly elapsedMs: number;
  readonly attempts: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly model?: string;
  readonly errorCode?: string;
}

export interface EvaluationSummary {
  readonly total: number;
  readonly valid: number;
  readonly correct: number;
  readonly failures: number;
  readonly effectiveAccuracy: number | null;
  readonly validAccuracy: number | null;
  readonly effectiveAccuracy95Wilson: readonly [number, number] | null;
  readonly macroF1: number | null;
  readonly brier: number | null;
  readonly nll: number | null;
  readonly ece: number | null;
  readonly scoreMAE: number | null;
  readonly latencyP50Ms: number | null;
  readonly latencyP95Ms: number | null;
  readonly latencyMeanMs: number | null;
  readonly totalSeconds: number;
  readonly effectiveRequestsPerSecond: number | null;
  readonly firstPassValid: number;
  readonly retriedRequests: number;
  readonly additionalAttempts: number;
  readonly inputTokensMean: number | null;
  readonly outputTokensMean: number | null;
}

export interface PairedContextEffect {
  readonly baseVariant: string;
  readonly comparisonVariant: string;
  readonly validPairs: number;
  readonly predictionChanged: number;
  readonly correctToWrong: number;
  readonly wrongToCorrect: number;
}

function assertCase(item: EvaluationCase): { question: Question; labels: string[]; gold: number } {
  if (!item || typeof item.id !== 'string' || item.id.trim() === '') throw new ConfigurationError('evaluation case id must be nonempty.');
  const question = item.request.questions[item.questionId];
  if (!question) throw new ConfigurationError(`evaluation case ${item.id} references a missing question.`);
  const labels = question.type === 'boolean' ? ['false', 'true'] : question.type === 'choice' ? Object.keys(question.criteria) : question.criteria.map((_, index) => String(index));
  let gold: number;
  if (question.type === 'boolean') {
    if (typeof item.gold !== 'boolean') throw new ConfigurationError(`evaluation case ${item.id} boolean gold must be a boolean.`);
    gold = item.gold ? 1 : 0;
  } else if (question.type === 'choice') {
    if (typeof item.gold !== 'string' || !Object.hasOwn(question.criteria, item.gold)) throw new ConfigurationError(`evaluation case ${item.id} choice gold must be a declared choice.`);
    gold = labels.indexOf(item.gold);
  } else {
    if (!Number.isSafeInteger(item.gold) || (item.gold as number) < 0 || (item.gold as number) >= labels.length) throw new ConfigurationError(`evaluation case ${item.id} score gold must be a valid rubric index.`);
    gold = item.gold as number;
  }
  return { question, labels, gold };
}

function probabilities(answer: Answer, question: Question, labels: readonly string[]): number[] | null {
  if (question.type === 'boolean' && answer.type === 'boolean') return [1 - answer.probability, answer.probability];
  if (question.type === 'choice' && answer.type === 'choice' && answer.probabilities) {
    const values = labels.map(label => answer.probabilities?.[label]);
    return values.every(value => typeof value === 'number') ? values as number[] : null;
  }
  if (question.type === 'score' && answer.type === 'score' && answer.probabilities) {
    const values = labels.map(label => answer.probabilities?.[label]);
    return values.every(value => typeof value === 'number') ? values as number[] : null;
  }
  return null;
}

function prediction(answer: Answer, question: Question, labels: readonly string[], distribution: readonly number[] | null): number | null {
  if (distribution) return distribution.reduce((best, value, index) => value > distribution[best]! ? index : best, 0);
  if (question.type === 'choice' && answer.type === 'choice') return labels.indexOf(answer.choice);
  if (question.type === 'score' && answer.type === 'score') return Math.max(0, Math.min(labels.length - 1, Math.round(answer.score)));
  if (question.type === 'boolean' && answer.type === 'boolean') return answer.probability > 0.5 ? 1 : 0;
  return null;
}

function scoreValue(answer: Answer, question: Question): number | null {
  return question.type === 'score' && answer.type === 'score' ? answer.score : null;
}

function transformedRequest(item: EvaluationCase, variant: EvaluationVariant): EvaluateRequest {
  const state = variant.transformState?.(item.request.state, item) ?? item.request.state;
  return {
    state,
    questions: item.request.questions,
    ...(item.request.model === undefined ? {} : { model: item.request.model }),
    ...(item.request.providerOptions === undefined ? {} : { providerOptions: item.request.providerOptions }),
  };
}

/** Run cases sequentially so wall-clock latency remains interpretable. */
export async function runEvaluation(client: EvaluationClient, cases: readonly EvaluationCase[], options: EvaluationRunOptions = {}): Promise<EvaluationRow[]> {
  if (!client || typeof client.evaluate !== 'function') throw new ConfigurationError('client must implement EvaluationClient.');
  const variants = options.variants ?? [{ id: 'base' }];
  if (!variants.length || variants.some(variant => typeof variant.id !== 'string' || variant.id.trim() === '')) throw new ConfigurationError('evaluation variants must have nonempty ids.');
  if (new Set(variants.map(variant => variant.id)).size !== variants.length) throw new ConfigurationError('evaluation variant ids must be unique.');
  const prepared = cases.map(item => ({ item, ...assertCase(item) }));
  const rows: EvaluationRow[] = [];
  for (const variant of variants) {
    for (const { item, question, labels, gold } of prepared) {
      const startedAt = Date.now();
      try {
        const result = await client.evaluate(transformedRequest(item, variant), options.requestOptions);
        const answer = result.answers[item.questionId];
        if (!answer || answer.type !== question.type) throw new ConfigurationError(`evaluation case ${item.id} returned a mismatched answer type.`);
        const distribution = probabilities(answer, question, labels);
        rows.push({
          caseId: item.id, variant: variant.id, task: question.type, labels, gold,
          prediction: prediction(answer, question, labels, distribution), probabilities: distribution,
          score: scoreValue(answer, question), ok: true, elapsedMs: Date.now() - startedAt,
          attempts: result.response.attempts, inputTokens: result.usage.inputTokens ?? null,
          outputTokens: result.usage.outputTokens ?? null, model: result.model,
        });
      } catch (error) {
        rows.push({
          caseId: item.id, variant: variant.id, task: question.type, labels, gold,
          prediction: null, probabilities: null, score: null, ok: false,
          elapsedMs: Date.now() - startedAt, attempts: 0, inputTokens: null, outputTokens: null,
          errorCode: error instanceof SystemOneError ? error.code : 'evaluation',
        });
      }
    }
  }
  return rows;
}

function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function quantile(values: readonly number[], q: number): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(ordered.length - 1, Math.ceil(ordered.length * q) - 1));
  return ordered[index]!;
}

export function wilsonInterval(correct: number, total: number): readonly [number, number] | null {
  if (!Number.isSafeInteger(correct) || !Number.isSafeInteger(total) || correct < 0 || total < 0 || correct > total) throw new ConfigurationError('Wilson counts must be nonnegative integers with correct <= total.');
  if (!total) return null;
  const z = 1.959963984540054;
  const p = correct / total;
  const center = (p + z * z / (2 * total)) / (1 + z * z / total);
  const radius = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / (1 + z * z / total);
  return [Math.max(0, center - radius), Math.min(1, center + radius)];
}

function macroF1(rows: readonly EvaluationRow[]): number | null {
  if (!rows.length) return null;
  const classCount = Math.max(...rows.map(row => row.labels.length));
  if (!classCount) return null;
  const confusion = Array.from({ length: classCount }, () => Array<number>(classCount).fill(0));
  for (const row of rows) if (row.prediction !== null && row.gold < classCount && row.prediction < classCount) confusion[row.gold]![row.prediction]!++;
  return mean(confusion.map((row, index) => {
    const tp = row[index]!;
    const fp = confusion.reduce((sum, other) => sum + other[index]!, 0) - tp;
    const fn = row.reduce((sum, value) => sum + value, 0) - tp;
    return 2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : 0;
  }));
}

/** Summarize any subset of rows, such as one task, model, or context variant. */
export function summarizeEvaluation(rows: readonly EvaluationRow[]): EvaluationSummary {
  const valid = rows.filter(row => row.ok && row.prediction !== null);
  const correct = valid.filter(row => row.prediction === row.gold).length;
  const probabilistic = valid.filter(row => row.probabilities !== null) as (EvaluationRow & { probabilities: readonly number[] })[];
  const brier: number[] = [];
  const nll: number[] = [];
  const bins = Array.from({ length: 10 }, () => ({ n: 0, confidence: 0, correct: 0 }));
  for (const row of probabilistic) {
    const p = row.probabilities;
    nll.push(-Math.log(Math.max(1e-12, p[row.gold] ?? 0)));
    brier.push(row.task === 'boolean'
      ? ((p[1] ?? 0) - row.gold) ** 2
      : p.reduce((sum, probability, index) => sum + (probability - Number(index === row.gold)) ** 2, 0));
    const predicted = row.prediction!;
    const confidence = p[predicted] ?? 0;
    const bin = bins[Math.min(9, Math.floor(confidence * 10))]!;
    bin.n++;
    bin.confidence += confidence;
    bin.correct += Number(predicted === row.gold);
  }
  const ece = probabilistic.length
    ? bins.reduce((sum, bin) => sum + (bin.n ? Math.abs(bin.correct / bin.n - bin.confidence / bin.n) * bin.n / probabilistic.length : 0), 0)
    : null;
  const scoreErrors = valid.filter(row => row.task === 'score' && row.score !== null).map(row => Math.abs(row.score! - row.gold));
  const latencies = rows.map(row => row.elapsedMs);
  const totalSeconds = latencies.reduce((sum, value) => sum + value, 0) / 1000;
  const input = rows.flatMap(row => row.inputTokens === null ? [] : [row.inputTokens]);
  const output = rows.flatMap(row => row.outputTokens === null ? [] : [row.outputTokens]);
  return {
    total: rows.length, valid: valid.length, correct, failures: rows.filter(row => !row.ok).length,
    effectiveAccuracy: rows.length ? correct / rows.length : null,
    validAccuracy: valid.length ? correct / valid.length : null,
    effectiveAccuracy95Wilson: wilsonInterval(correct, rows.length),
    macroF1: macroF1(valid), brier: mean(brier), nll: mean(nll), ece,
    scoreMAE: mean(scoreErrors), latencyP50Ms: quantile(latencies, 0.5), latencyP95Ms: quantile(latencies, 0.95),
    latencyMeanMs: mean(latencies), totalSeconds,
    effectiveRequestsPerSecond: totalSeconds > 0 ? valid.length / totalSeconds : null,
    firstPassValid: valid.filter(row => row.attempts === 1).length,
    retriedRequests: rows.filter(row => row.attempts > 1).length,
    additionalAttempts: rows.reduce((sum, row) => sum + Math.max(0, row.attempts - 1), 0),
    inputTokensMean: mean(input), outputTokensMean: mean(output),
  };
}

/** Compare predictions for the same cases across two context variants. */
export function pairedContextEffect(rows: readonly EvaluationRow[], baseVariant: string, comparisonVariant: string): PairedContextEffect {
  const byCase = new Map<string, Map<string, EvaluationRow>>();
  for (const row of rows) {
    const variants = byCase.get(row.caseId) ?? new Map<string, EvaluationRow>();
    variants.set(row.variant, row);
    byCase.set(row.caseId, variants);
  }
  let validPairs = 0, predictionChanged = 0, correctToWrong = 0, wrongToCorrect = 0;
  for (const variants of byCase.values()) {
    const base = variants.get(baseVariant), comparison = variants.get(comparisonVariant);
    if (!base?.ok || !comparison?.ok || base.prediction === null || comparison.prediction === null) continue;
    validPairs++;
    if (base.prediction !== comparison.prediction) predictionChanged++;
    const baseCorrect = base.prediction === base.gold, comparisonCorrect = comparison.prediction === comparison.gold;
    if (baseCorrect && !comparisonCorrect) correctToWrong++;
    if (!baseCorrect && comparisonCorrect) wrongToCorrect++;
  }
  return { baseVariant, comparisonVariant, validPairs, predictionChanged, correctToWrong, wrongToCorrect };
}

/** Put the target in the middle of synthetic background text for context-stress evaluation. */
export function backgroundVariant(id: string, background: string): EvaluationVariant {
  if (typeof id !== 'string' || id.trim() === '' || typeof background !== 'string') throw new ConfigurationError('backgroundVariant requires a nonempty id and string background.');
  return {
    id,
    transformState(state): State {
      if (typeof state === 'string') return `${background}\n\n${state}\n\n${background}`;
      return { backgroundBefore: background, target: state as JsonValue, backgroundAfter: background };
    },
  };
}
