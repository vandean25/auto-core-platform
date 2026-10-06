import { DECISION_USE_CASES } from '../src/decision/decision.constants.js';
import type { DecisionProvider } from '../src/decision/decision-provider.js';
import { evaluateExamples } from './agent-eval.runner.js';

const documentExample = (
  id: string,
  text: string,
  label: string,
  tags: string[] = [],
) => ({
  id,
  use_case: DECISION_USE_CASES.DOCUMENT_SORT,
  difficulty: 'ambiguous',
  label,
  choices: ['Rechnung', 'Sonstiges'],
  input: { text },
  tags,
});

describe('agent evaluation runner', () => {
  it('runs rules without creating or calling a model provider', async () => {
    const examples = [documentExample('doc-1', 'Rechnung DEMO', 'Rechnung')];

    const results = await evaluateExamples({ examples, mode: 'rules' });

    expect(results[0]).toMatchObject({
      suggestion: 'Rechnung',
      correct: true,
      rechecked_correct: true,
      provider: 'rules',
    });
    expect(results[0].latency_ms).toBeGreaterThan(0);
  });

  it('uses rules as final when they have one unambiguous signal', async () => {
    const decide = jest.fn().mockResolvedValue({
      choice: 'Sonstiges',
      confidence: 0.99,
      latency_ms: 15,
      provider: 'mock-jev',
      model: 'mock',
      raw_ref: 'mock-ref',
    });
    const provider: DecisionProvider = { providerId: 'mock-jev', decide };
    const examples = [documentExample('doc-1', 'Rechnung DEMO', 'Rechnung')];

    const results = await evaluateExamples({
      examples,
      mode: 'rules+jev',
      provider,
    });

    expect(decide).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({
      suggestion: 'Rechnung',
      jev_suggestion: null,
      rule_suggestion: 'Rechnung',
      correct: true,
    });
  });

  it('uses Jev only for ambiguous hybrid cases and re-checks the choice', async () => {
    const decide = jest.fn().mockResolvedValue({
      choice: 'Rechnung',
      confidence: 0.9,
      latency_ms: 12,
      provider: 'mock-jev',
      model: 'mock',
      raw_ref: 'mock-ref',
      input_tokens: 25,
      output_tokens: 0,
    });
    const provider: DecisionProvider = { providerId: 'mock-jev', decide };
    const examples = [
      documentExample('doc-1', 'ohne Signal', 'Sonstiges', [
        'false_completion',
      ]),
    ];

    const results = await evaluateExamples({
      examples,
      mode: 'rules+jev',
      provider,
    });

    expect(decide).toHaveBeenCalledTimes(1);
    expect(results[0]).toMatchObject({
      suggestion: 'Rechnung',
      jev_suggestion: 'Rechnung',
      rule_suggestion: 'Sonstiges',
      correct: false,
      rechecked_correct: false,
      input_tokens: 25,
      output_tokens: 0,
      tags: ['false_completion'],
    });
  });

  it('removes secret-shaped strings from provider errors', async () => {
    const provider: DecisionProvider = {
      providerId: 'mock-jev',
      decide: jest.fn().mockRejectedValue(new Error('request failed sk-abcdefghij123456')),
    };

    const results = await evaluateExamples({
      examples: [documentExample('doc-1', 'ohne Signal', 'Sonstiges')],
      mode: 'jev',
      provider,
    });

    expect(results[0].error).toBe('request failed [REDACTED]');
  });
});
