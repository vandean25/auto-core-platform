import { AgentPolicyTier } from '@prisma/client';
import { AgentProposalPolicyEvaluator } from './agent-proposal-policy-evaluator.service.js';

describe('AgentProposalPolicyEvaluator', () => {
  let agentPolicyService: { evaluate: jest.Mock };
  let executor: { buildPolicyContext: jest.Mock };
  let evaluator: AgentProposalPolicyEvaluator;

  beforeEach(() => {
    agentPolicyService = {
      evaluate: jest.fn().mockResolvedValue({
        tier: AgentPolicyTier.PROPOSE,
        reasons: [],
      }),
    };
    executor = {
      buildPolicyContext: jest.fn().mockResolvedValue({ reversible: false }),
    };
    evaluator = new AgentProposalPolicyEvaluator(agentPolicyService as any);
  });

  it('prices workshop line items from the payload without asking the executor', async () => {
    await evaluator.evaluate(
      'workshop_order.add_line',
      { unit_price: 20, quantity: 2 },
      executor as any,
    );

    expect(executor.buildPolicyContext).not.toHaveBeenCalled();
    expect(agentPolicyService.evaluate).toHaveBeenCalledWith(
      {
        action_type: 'workshop_order.add_line',
        context: { amount_eur: 40 },
      },
      { skipAdminCheck: true },
    );
  });

  it('asks the executor for the context of every other action', async () => {
    const payload = { customer_id: 'c-1' };

    await evaluator.evaluate('customer.update', payload, executor as any);

    expect(executor.buildPolicyContext).toHaveBeenCalledWith(payload);
    expect(agentPolicyService.evaluate).toHaveBeenCalledWith(
      { action_type: 'customer.update', context: { reversible: false } },
      { skipAdminCheck: true },
    );
  });

  it('returns the policy decision unchanged', async () => {
    agentPolicyService.evaluate.mockResolvedValue({
      tier: AgentPolicyTier.HUMAN_ONLY,
      reasons: ['too_large'],
    });

    await expect(
      evaluator.evaluate('customer.update', {}, executor as any),
    ).resolves.toEqual({
      tier: AgentPolicyTier.HUMAN_ONLY,
      reasons: ['too_large'],
    });
  });
});
