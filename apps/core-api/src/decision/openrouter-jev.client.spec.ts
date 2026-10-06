import {
  OpenRouterJevClient,
  OpenRouterJevHttpError,
  OpenRouterJevInputTooLargeError,
  OpenRouterJevMalformedResponseError,
  OpenRouterJevTimeoutError,
} from './openrouter-jev.client.js';
import {
  DECISION_CHARS_PER_TOKEN_ESTIMATE,
  DECISION_USE_CASES,
} from './decision.constants.js';

describe('OpenRouterJevClient', () => {
  const baseInput = {
    useCase: DECISION_USE_CASES.DOCUMENT_SORT,
    input: { text: 'Rechnung DEMO' },
    choices: ['Rechnung', 'Sonstiges'],
  };

  it('returns a parsed choice on success', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'resp-1',
        model: 'typesafe/jev-1.13',
        answers: { choice: { type: 'choice', choice: 'Rechnung' } },
        usage: { inputTokens: 10, outputTokens: 0 },
      }),
    });
    const client = new OpenRouterJevClient({
      apiKey: 'test-key',
      timeoutMs: 1000,
      fetchImpl,
    });
    const result = await client.decide(baseInput);
    expect(result.choice).toBe('Rechnung');
    expect(result.raw_ref).toBe('resp-1');
    expect(result.input_tokens).toBe(10);
    expect(result.output_tokens).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('estimates serialized input tokens when provider usage is absent', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        answers: { choice: { type: 'choice', choice: 'Rechnung' } },
      }),
    });
    const client = new OpenRouterJevClient({
      apiKey: 'test-key',
      timeoutMs: 1000,
      fetchImpl,
    });

    const result = await client.decide(baseInput);
    const requestInit = fetchImpl.mock.calls[0][1] as RequestInit;
    const request = JSON.parse(requestInit.body as string);
    const question = request.questions.choice;
    const serializedInput = JSON.stringify({
      question,
      state: request.state,
    });

    expect(question.instructions).toContain(baseInput.useCase);
    expect(question.criteria).toEqual({
      Rechnung: 'Option "Rechnung"',
      Sonstiges: 'Option "Sonstiges"',
    });
    expect(result).toMatchObject({
      input_tokens: undefined,
      estimated_input_tokens: Math.ceil(
        serializedInput.length / DECISION_CHARS_PER_TOKEN_ESTIMATE,
      ),
    });
  });

  it('retries once on 5xx', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'typesafe/jev-1.13',
          answers: { choice: { type: 'choice', choice: 'Sonstiges' } },
          usage: { inputTokens: 1, outputTokens: 0 },
        }),
      });
    const client = new OpenRouterJevClient({
      apiKey: 'test-key',
      timeoutMs: 1000,
      fetchImpl,
    });
    const result = await client.decide(baseInput);
    expect(result.choice).toBe('Sonstiges');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries once on timeout', async () => {
    const fetchImpl = jest
      .fn()
      .mockImplementationOnce(() => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'typesafe/jev-1.13',
          answers: { choice: { type: 'choice', choice: 'Rechnung' } },
          usage: { inputTokens: 1, outputTokens: 0 },
        }),
      });
    const client = new OpenRouterJevClient({
      apiKey: 'test-key',
      timeoutMs: 5,
      fetchImpl,
    });
    await expect(client.decide(baseInput)).resolves.toMatchObject({
      choice: 'Rechnung',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('throws on malformed response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ model: 'typesafe/jev-1.13' }),
    });
    const client = new OpenRouterJevClient({
      apiKey: 'test-key',
      timeoutMs: 1000,
      fetchImpl,
    });
    await expect(client.decide(baseInput)).rejects.toBeInstanceOf(
      OpenRouterJevMalformedResponseError,
    );
  });

  it('rejects oversize input', async () => {
    const client = new OpenRouterJevClient({
      apiKey: 'test-key',
      timeoutMs: 1000,
      fetchImpl: jest.fn(),
    });
    const huge = 'x'.repeat(200_000);
    await expect(
      client.decide({
        ...baseInput,
        input: { text: huge },
      }),
    ).rejects.toBeInstanceOf(OpenRouterJevInputTooLargeError);
  });

  it('surfaces HTTP errors after retry', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    const client = new OpenRouterJevClient({
      apiKey: 'test-key',
      timeoutMs: 1000,
      fetchImpl,
    });
    await expect(client.decide(baseInput)).rejects.toBeInstanceOf(
      OpenRouterJevHttpError,
    );
  });

  it('throws timeout when both attempts abort', async () => {
    const fetchImpl = jest.fn().mockImplementation(() => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      return Promise.reject(error);
    });
    const client = new OpenRouterJevClient({
      apiKey: 'test-key',
      timeoutMs: 5,
      fetchImpl,
    });
    await expect(client.decide(baseInput)).rejects.toBeInstanceOf(
      OpenRouterJevTimeoutError,
    );
  });
});
