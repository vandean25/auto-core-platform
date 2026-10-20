import {
  createAgentProposalSpecHarness,
  createMockProposal,
  proposalId,
} from './agent-proposal.spec.support.js';

/**
 * A customer proposal changes customer master data only after a person
 * approved it (AUT-613). A rejected proposal never reaches the executor, so no
 * customer row is written.
 */
describe('customer proposal decisions (AUT-613)', () => {
  it('writes no customer data when the proposal is rejected', async () => {
    const h = createAgentProposalSpecHarness();
    h.mockPrisma.agentProposal.findFirst.mockResolvedValue(
      createMockProposal({
        action_type: 'customer.create',
        payload_json: {
          action: 'customer.create',
          idempotency_key: 'aut613-create-1',
          fields: {
            customer_type: 'PRIVATE',
            first_name: 'Max',
            last_name: 'Mustermann',
            email: 'max@example.at',
          },
        },
      }),
    );
    h.mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });

    await h.decisions.rejectProposal(proposalId, {
      reason: 'Kunde existiert bereits',
    });

    expect(h.mockPrisma.agentProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: proposalId }),
        data: expect.objectContaining({ status: 'REJECTED' }),
      }),
    );
    expect(h.mockPrisma.customer.findFirst).not.toHaveBeenCalled();
    expect(h.mockPrisma.customer.updateMany).not.toHaveBeenCalled();
  });

  it('creates the customer when the proposal is approved', async () => {
    const h = createAgentProposalSpecHarness();
    const created = {
      id: '00000000-0000-4000-8000-000000000040',
      tenant_id: '00000000-0000-0000-0000-000000000001',
      type: 'PRIVATE',
      first_name: 'Max',
      last_name: 'Mustermann',
      email: 'max@example.at',
    };
    h.mockPrisma.customer.create = jest.fn().mockResolvedValue(created);
    h.mockPrisma.customer.findMany = jest.fn().mockResolvedValue([]);
    h.mockPrisma.customer.findFirst = jest.fn().mockResolvedValue(null);
    h.mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });
    h.mockPrisma.agentProposal.findFirst.mockResolvedValue(
      createMockProposal({
        action_type: 'customer.create',
        payload_json: {
          action: 'customer.create',
          idempotency_key: 'aut613-create-1',
          fields: {
            customer_type: 'PRIVATE',
            first_name: 'Max',
            last_name: 'Mustermann',
            email: 'max@example.at',
          },
        },
      }),
    );

    await h.decisions.approveProposal(proposalId);

    expect(h.mockPrisma.customer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          first_name: 'Max',
          last_name: 'Mustermann',
        }),
      }),
    );
  });
});
