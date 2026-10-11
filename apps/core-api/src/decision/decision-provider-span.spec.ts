import { beforeEach, describe, it, expect, jest } from '@jest/globals';

const mockStartSpan = jest.fn();
const mockGetClient = jest.fn();

jest.unstable_mockModule('@sentry/node', () => ({
  startSpan: mockStartSpan,
  getClient: mockGetClient,
}));

const { traceDecisionProvider } = await import('./decision-provider-span.js');
type DecisionProviderType = import('./decision-provider.js').DecisionProvider;
type DecisionResultType = import('./decision.types.js').DecisionResult;

const suggestion: DecisionResultType = {
  choice: 'match',
  raw_ref: 'ref-1',
  latency_ms: 12,
  provider: 'openrouter',
  model: 'model-x',
};

function provider(
  decide: DecisionProviderType['decide'],
): DecisionProviderType {
  return { providerId: 'openrouter', decide };
}

describe('traceDecisionProvider', () => {
  const span = {
    setAttribute: jest.fn(),
    setAttributes: jest.fn(),
  };

  beforeEach(() => {
    mockStartSpan.mockReset();
    mockGetClient.mockReset();
    span.setAttribute.mockReset();
    mockStartSpan.mockImplementation((_options, callback) =>
      (callback as (s: unknown) => unknown)(span),
    );
  });

  it('returns the provider suggestion unchanged when Sentry is not initialised', async () => {
    mockGetClient.mockReturnValue(undefined);
    const decide = jest.fn<DecisionProviderType['decide']>(async () => suggestion);
    const input = {
      useCase: 'document_sort' as const,
      input: { text: 'customer note' },
      choices: ['match', 'no_match'],
    };

    await expect(traceDecisionProvider(provider(decide), input)).resolves.toBe(
      suggestion,
    );
    expect(decide).toHaveBeenCalledWith(input);
    expect(mockStartSpan).not.toHaveBeenCalled();
  });

  it('records provider, use case, choice count and outcome, never the input', async () => {
    mockGetClient.mockReturnValue({});
    const decide = jest.fn<DecisionProviderType['decide']>(async () => suggestion);

    await traceDecisionProvider(provider(decide), {
      useCase: 'document_sort',
      input: { text: 'Musterwerkstatt Nord' },
      choices: ['match', 'no_match'],
    });

    expect(mockStartSpan).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Agent decision',
        op: 'agent.decision',
        attributes: {
          'agent.decision.provider': 'openrouter',
          'agent.decision.use_case': 'document_sort',
          'agent.decision.choice_count': 2,
        },
      }),
      expect.any(Function),
    );
    expect(span.setAttribute).toHaveBeenCalledWith(
      'agent.decision.outcome',
      'suggested',
    );
    expect(JSON.stringify(mockStartSpan.mock.calls)).not.toContain(
      'Musterwerkstatt',
    );
  });

  it('records outcome none when the provider returns no suggestion', async () => {
    mockGetClient.mockReturnValue({});
    const decide = jest.fn<DecisionProviderType['decide']>(async () => null);

    await expect(
      traceDecisionProvider(provider(decide), {
        useCase: 'document_sort',
        input: {},
        choices: ['a'],
      }),
    ).resolves.toBeNull();
    expect(span.setAttribute).toHaveBeenCalledWith(
      'agent.decision.outcome',
      'none',
    );
  });

  it('rethrows provider errors unchanged', async () => {
    mockGetClient.mockReturnValue({});
    const failure = new Error('provider down');
    const decide = jest.fn<DecisionProviderType['decide']>(async () => {
      throw failure;
    });

    await expect(
      traceDecisionProvider(provider(decide), {
        useCase: 'document_sort',
        input: {},
        choices: ['a'],
      }),
    ).rejects.toBe(failure);
  });
});
