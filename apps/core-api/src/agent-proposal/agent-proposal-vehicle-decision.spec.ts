import {
  createAgentProposalSpecHarness,
  createMockProposal,
  proposalId,
} from './agent-proposal.spec.support.js';

/**
 * A vehicle proposal changes vehicle master data only after a person
 * approves it (AUT-614). A rejected proposal never reaches the executor, so no
 * vehicle row is written.
 */
describe('vehicle proposal decisions (AUT-614)', () => {
  it('writes no vehicle data when the proposal is rejected', async () => {
    const h = createAgentProposalSpecHarness();
    h.mockPrisma.vehicle = {
      create: jest.fn(),
      updateMany: jest.fn(),
    } as never;
    h.mockPrisma.agentProposal.findFirst.mockResolvedValue(
      createMockProposal({
        action_type: 'vehicle.create',
        payload_json: {
          action: 'vehicle.create',
          idempotency_key: 'aut614-create-1',
          fields: {
            make: 'VW',
            model: 'Golf',
            year: 2021,
            plate: 'W12345A',
          },
          duplicate_check: { digest: 'd', candidate_ids: [] },
          warnings: [],
        },
      }),
    );
    h.mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });

    await h.decisions.rejectProposal(proposalId, {
      reason: 'Fahrzeug existiert bereits',
    });

    expect(h.mockPrisma.agentProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: proposalId }),
        data: expect.objectContaining({ status: 'REJECTED' }),
      }),
    );
    expect(h.mockPrisma.vehicle.create).not.toHaveBeenCalled();
    expect(h.mockPrisma.vehicle.updateMany).not.toHaveBeenCalled();
  });

  it('creates the vehicle when the proposal is approved', async () => {
    const h = createAgentProposalSpecHarness();
    const created = {
      id: '00000000-0000-4000-8000-000000000040',
      tenant_id: '00000000-0000-0000-0000-000000000001',
      make: 'VW',
      model: 'Golf',
      year: 2021,
      plate: 'W12345A',
      plate_normalized: 'W12345A',
    };
    h.mockPrisma.vehicle = {
      create: jest.fn().mockResolvedValue(created),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    } as never;
    h.mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });
    h.mockPrisma.agentProposal.findFirst.mockResolvedValue(
      createMockProposal({
        action_type: 'vehicle.create',
        payload_json: {
          action: 'vehicle.create',
          idempotency_key: 'aut614-create-1',
          fields: {
            make: 'VW',
            model: 'Golf',
            year: 2021,
            plate: 'W12345A',
          },
          duplicate_check: { digest: 'd', candidate_ids: [] },
          warnings: [],
        },
      }),
    );

    await h.decisions.approveProposal(proposalId);

    expect(h.mockPrisma.vehicle.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          make: 'VW',
          model: 'Golf',
          plate_normalized: 'W12345A',
        }),
      }),
    );
  });
});
