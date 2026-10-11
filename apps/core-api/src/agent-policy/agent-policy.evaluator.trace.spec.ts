import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AgentPolicyTier } from '@prisma/client';
import type { ResolvedAgentPolicyRule } from './agent-policy.types.js';

const mockStartSpan = jest.fn();
const mockGetClient = jest.fn();

jest.unstable_mockModule('@sentry/node', () => ({
  startSpan: mockStartSpan,
  getClient: mockGetClient,
  getActiveSpan: jest.fn(),
  getCurrentScope: jest.fn(),
  getIsolationScope: jest.fn(),
  getTraceData: jest.fn(),
}));

const { evaluateAgentPolicy } = await import('./agent-policy.evaluator.js');

const autoRule: ResolvedAgentPolicyRule = {
  id: 'rule-1',
  version: 2,
  action_type: 'inventory.part_reserve',
  tier: AgentPolicyTier.AUTO,
  conditions: {},
  enabled: true,
  source: 'platform',
  created_at: new Date(0),
  updated_at: new Date(0),
};

describe('evaluateAgentPolicy span', () => {
  const span = { setAttribute: jest.fn(), setAttributes: jest.fn() };

  beforeEach(() => {
    mockStartSpan.mockReset();
    mockGetClient.mockReset();
    span.setAttribute.mockReset();
    span.setAttributes.mockReset();
    mockGetClient.mockReturnValue({});
    mockStartSpan.mockImplementation((_options, callback) =>
      (callback as (s: unknown) => unknown)(span),
    );
  });

  it('records one agent.policy.evaluate span with the tier and the allowed outcome', () => {
    const result = evaluateAgentPolicy('inventory.part_reserve', {}, autoRule);

    expect(result.tier).toBe(AgentPolicyTier.AUTO);
    expect(mockStartSpan).toHaveBeenCalledWith(
      {
        name: 'Evaluate agent policy',
        op: 'agent.policy.evaluate',
        attributes: {},
      },
      expect.any(Function),
    );
    expect(span.setAttributes).toHaveBeenCalledWith({
      'agent.policy.tier': AgentPolicyTier.AUTO,
      'agent.policy.outcome': 'allowed',
    });
  });

  it('records the refused outcome for an unknown action', () => {
    const result = evaluateAgentPolicy('inventory.unknown', {}, null);

    expect(result.tier).toBe(AgentPolicyTier.HUMAN_ONLY);
    expect(span.setAttributes).toHaveBeenCalledWith({
      'agent.policy.tier': AgentPolicyTier.HUMAN_ONLY,
      'agent.policy.outcome': 'refused',
    });
  });

  it('never sends the action type string, which can come from free text', () => {
    evaluateAgentPolicy('Max Muster ist Kunde', {}, null);

    expect(JSON.stringify(mockStartSpan.mock.calls)).not.toContain(
      'Max Muster',
    );
    expect(JSON.stringify(span.setAttributes.mock.calls)).not.toContain(
      'Max Muster',
    );
  });

  it('runs without a span when Sentry is not initialised', () => {
    mockGetClient.mockReturnValue(undefined);

    const result = evaluateAgentPolicy('inventory.part_reserve', {}, autoRule);

    expect(result.tier).toBe(AgentPolicyTier.AUTO);
    expect(mockStartSpan).not.toHaveBeenCalled();
  });
});
