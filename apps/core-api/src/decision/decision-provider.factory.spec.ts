import { createDecisionProvider } from './decision-provider.factory.js';

describe('createDecisionProvider', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('defaults to noop without network', async () => {
    delete process.env.DECISION_PROVIDER;
    const provider = createDecisionProvider(process.env);
    expect(provider.providerId).toBe('noop');
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const result = await provider.decide({
      useCase: 'document_sort',
      input: { text: 'demo' },
      choices: ['Sonstiges'],
    });
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
