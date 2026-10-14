import type { DecisionProvider } from './decision-provider.js';
import {
  DecisionProviderClient,
  judgeSuggestion,
} from './decision-provider-client.service.js';
import type { DecisionChoiceInput, DecisionResult } from './decision.types.js';

const ORIGINAL_ENV = { ...process.env };
const INPUT: DecisionChoiceInput = {
  useCase: 'import_row_matching',
  input: { row: {} },
  choices: ['choice_1', 'choice_2'],
};

function result(choice: string): DecisionResult {
  return {
    choice,
    raw_ref: 'raw-1',
    latency_ms: 12,
    provider: 'openrouter-jev',
    model: 'typesafe/jev-1.13',
  };
}

function buildClient(decide: jest.Mock) {
  const provider = {
    providerId: 'openrouter-jev',
    decide,
  } as unknown as DecisionProvider;
  return new DecisionProviderClient(provider);
}

describe('DecisionProviderClient', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test' };
    delete process.env.DECISION_HTTP_TIMEOUT_MS;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('exposes the provider id of the wrapped provider', () => {
    expect(buildClient(jest.fn()).providerId).toBe('openrouter-jev');
  });

  it('returns budget_exceeded without calling the provider when the deadline has passed', async () => {
    const decide = jest.fn();
    const client = buildClient(decide);

    await expect(client.ask(INPUT, Date.now() - 1)).resolves.toEqual({
      ok: false,
      reason: 'budget_exceeded',
      suggestion: null,
    });
    expect(decide).not.toHaveBeenCalled();
  });

  it('returns the suggestion when its choice is in the allowed list', async () => {
    const client = buildClient(jest.fn().mockResolvedValue(result('choice_2')));

    await expect(client.ask(INPUT, Date.now() + 5_000)).resolves.toEqual({
      ok: true,
      suggestion: result('choice_2'),
    });
  });

  it('returns invalid_choice for a choice outside the allowed list', async () => {
    const client = buildClient(jest.fn().mockResolvedValue(result('choice_9')));

    await expect(client.ask(INPUT, Date.now() + 5_000)).resolves.toEqual({
      ok: false,
      reason: 'invalid_choice',
      suggestion: null,
    });
  });

  it('returns no_suggestion when the provider has no answer', async () => {
    const client = buildClient(jest.fn().mockResolvedValue(null));

    await expect(client.ask(INPUT, Date.now() + 5_000)).resolves.toEqual({
      ok: false,
      reason: 'no_suggestion',
      suggestion: null,
    });
  });

  it('returns timeout when the provider does not answer within the bound', async () => {
    process.env.DECISION_HTTP_TIMEOUT_MS = '20';
    const client = buildClient(
      jest.fn(() => new Promise<never>(() => undefined)),
    );

    await expect(client.ask(INPUT, Date.now() + 5_000)).resolves.toEqual({
      ok: false,
      reason: 'timeout',
      suggestion: null,
    });
  });

  it('bounds the call by the remaining budget when that is shorter than the env timeout', async () => {
    const client = buildClient(
      jest.fn(() => new Promise<never>(() => undefined)),
    );
    const started = Date.now();

    await expect(client.ask(INPUT, Date.now() + 20)).resolves.toMatchObject({
      reason: 'timeout',
    });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('returns provider_error without the provider message', async () => {
    const client = buildClient(
      jest.fn().mockRejectedValue(new Error('upstream secret detail')),
    );

    const call = await client.ask(INPUT, Date.now() + 5_000);

    expect(call).toEqual({
      ok: false,
      reason: 'provider_error',
      suggestion: null,
    });
    expect(JSON.stringify(call)).not.toContain('upstream secret detail');
  });
});

describe('judgeSuggestion', () => {
  it('treats a missing suggestion as no_suggestion', () => {
    expect(judgeSuggestion(['choice_1'], null)).toEqual({
      ok: false,
      reason: 'no_suggestion',
      suggestion: null,
    });
  });

  it('accepts only choices from the allowed list', () => {
    expect(judgeSuggestion(['choice_1'], result('choice_1'))).toEqual({
      ok: true,
      suggestion: result('choice_1'),
    });
    expect(judgeSuggestion(['choice_1'], result('Rechnung'))).toEqual({
      ok: false,
      reason: 'invalid_choice',
      suggestion: null,
    });
  });
});
