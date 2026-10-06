import { createHash } from 'node:crypto';
import {
  DECISION_CHARS_PER_TOKEN_ESTIMATE,
  DECISION_MAX_INPUT_TOKEN_ESTIMATE,
  OPENROUTER_JEV_DEFAULT_MODEL,
} from './decision.constants.js';
import type { DecisionChoiceInput, DecisionResult } from './decision.types.js';

export const OPENROUTER_DECISIONS_URL =
  'https://openrouter.ai/api/alpha/decisions';

/**
 * OpenRouter Decisions API (alpha) — pinned from docs on 2026-10-03:
 * https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request
 *
 * Request (POST, JSON):
 * - model: string (required) — e.g. typesafe/jev-1.13
 * - questions: Record<string, { type: 'choice'|'noul'|'score'; instructions: string; criteria: object|array }>
 * - state: string | object | array (required) — context evaluated by the model
 * - provider?: { allow_fallbacks?: boolean }
 * - session_id?: string (max 256)
 * - trace?: { trace_id?: string; trace_name?: string; ... }
 * - user?: string
 *
 * Response (JSON):
 * - answers: Record<string, { type: 'choice'; choice: string } | { type: 'noul'; noul: number } | { type: 'score'; score: number }>
 * - model: string
 * - usage: { inputTokens: number; outputTokens: number }
 * - id?: string
 * - provider?: string
 */
export type HttpFetch = typeof fetch;

export class OpenRouterJevInputTooLargeError extends Error {
  constructor() {
    super('Decision input exceeds maximum estimated token size');
    this.name = 'OpenRouterJevInputTooLargeError';
  }
}

export class OpenRouterJevTimeoutError extends Error {
  constructor() {
    super('OpenRouter Jev request timed out');
    this.name = 'OpenRouterJevTimeoutError';
  }
}

export class OpenRouterJevHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'OpenRouterJevHttpError';
    this.status = status;
  }
}

export class OpenRouterJevMalformedResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenRouterJevMalformedResponseError';
  }
}

export type OpenRouterJevClientConfig = {
  apiKey: string | undefined;
  modelId?: string;
  timeoutMs: number;
  fetchImpl?: HttpFetch;
};

const DECISION_QUESTION_KEY = 'choice';

export class OpenRouterJevClient {
  private readonly apiKey: string | undefined;
  private readonly modelId: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: HttpFetch;

  constructor(config: OpenRouterJevClientConfig) {
    this.apiKey = normalizeSecret(config.apiKey);
    this.modelId = config.modelId?.trim() || OPENROUTER_JEV_DEFAULT_MODEL;
    this.timeoutMs = config.timeoutMs;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async decide(input: DecisionChoiceInput): Promise<DecisionResult> {
    if (!this.apiKey) {
      throw new OpenRouterJevHttpError(
        503,
        'OpenRouter API key is not configured',
      );
    }

    assertInputSizeWithinLimit(input);

    const criteria = buildChoiceCriteria(input.choices);
    const body = {
      model: this.modelId,
      questions: {
        [DECISION_QUESTION_KEY]: {
          type: 'choice',
          instructions: buildInstructions(input.useCase),
          criteria,
        },
      },
      state: {
        use_case: input.useCase,
        input: input.input,
        context: input.context ?? {},
      },
    };

    const started = Date.now();
    const response = await this.postWithRetry(body);
    const latency_ms = Date.now() - started;
    const payload = (await response.json()) as unknown;
    const choice = extractChoiceAnswer(payload);
    const raw_ref =
      extractResponseId(payload) ??
      createHash('sha256').update(JSON.stringify(payload)).digest('hex');

    return {
      choice,
      raw_ref,
      latency_ms,
      provider: 'openrouter-jev',
      model: extractResponseModel(payload) ?? this.modelId,
      rationale: extractChoiceRationale(payload),
      confidence: extractChoiceConfidence(payload),
    };
  }

  private async postWithRetry(body: unknown): Promise<Response> {
    try {
      return await this.postOnce(body);
    } catch (error) {
      if (error instanceof OpenRouterJevTimeoutError) {
        return await this.postOnce(body);
      }
      if (error instanceof OpenRouterJevHttpError && error.status >= 500) {
        return await this.postOnce(body);
      }
      throw error;
    }
  }

  private async postOnce(body: unknown): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(OPENROUTER_DECISIONS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new OpenRouterJevHttpError(
          response.status,
          `OpenRouter decisions request failed with status ${response.status}`,
        );
      }
      return response;
    } catch (error) {
      if (isAbortError(error)) {
        throw new OpenRouterJevTimeoutError();
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function buildInstructions(useCase: string): string {
  return `Select the single best option for use case "${useCase}". Respond using the choice question only.`;
}

function buildChoiceCriteria(choices: string[]): Record<string, string> {
  const criteria: Record<string, string> = {};
  for (const choice of choices) {
    criteria[choice] = `Option "${choice}"`;
  }
  return criteria;
}

function assertInputSizeWithinLimit(input: DecisionChoiceInput): void {
  const serialized = JSON.stringify({
    useCase: input.useCase,
    input: input.input,
    choices: input.choices,
    context: input.context ?? {},
  });
  const estimatedTokens = Math.ceil(
    serialized.length / DECISION_CHARS_PER_TOKEN_ESTIMATE,
  );
  if (estimatedTokens > DECISION_MAX_INPUT_TOKEN_ESTIMATE) {
    throw new OpenRouterJevInputTooLargeError();
  }
}

function extractChoiceAnswer(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    throw new OpenRouterJevMalformedResponseError('Response is not an object');
  }
  const answers = (payload as { answers?: unknown }).answers;
  if (!answers || typeof answers !== 'object') {
    throw new OpenRouterJevMalformedResponseError('Missing answers object');
  }
  const entry = (answers as Record<string, unknown>)[DECISION_QUESTION_KEY];
  if (!entry || typeof entry !== 'object') {
    throw new OpenRouterJevMalformedResponseError('Missing choice answer');
  }
  const choice = (entry as { choice?: unknown }).choice;
  if (typeof choice !== 'string' || choice.trim() === '') {
    throw new OpenRouterJevMalformedResponseError('Choice answer is invalid');
  }
  return choice;
}

function extractResponseId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  const id = (payload as { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
}

function extractResponseModel(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  const model = (payload as { model?: unknown }).model;
  return typeof model === 'string' ? model : undefined;
}

function extractChoiceRationale(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  const answers = (payload as { answers?: unknown }).answers;
  if (!answers || typeof answers !== 'object') {
    return undefined;
  }
  const entry = (answers as Record<string, unknown>)[DECISION_QUESTION_KEY];
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }
  const rationale = (entry as { rationale?: unknown }).rationale;
  return typeof rationale === 'string' ? rationale : undefined;
}

function extractChoiceConfidence(payload: unknown): number | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  const answers = (payload as { answers?: unknown }).answers;
  if (!answers || typeof answers !== 'object') {
    return undefined;
  }
  const entry = (answers as Record<string, unknown>)[DECISION_QUESTION_KEY];
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }
  const confidence = (entry as { confidence?: unknown }).confidence;
  return typeof confidence === 'number' ? confidence : undefined;
}

function normalizeSecret(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.message.includes('aborted'))
  );
}
