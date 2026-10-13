import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AgentPolicyTier, AgentProposalStatus, Prisma } from '@prisma/client';
import {
  createAgentProposalSpecHarness,
  createMockProposal,
  tenantId,
  traceId,
} from './agent-proposal.spec.support.js';

describe('AgentProposalSubmissionService', () => {
  let h: ReturnType<typeof createAgentProposalSpecHarness>;

  beforeEach(() => {
    h = createAgentProposalSpecHarness();
  });

  it('creates a PENDING proposal with the caller trace id and PROPOSE tier by default', async () => {
    h.mockPrisma.agentProposal.create.mockResolvedValue(createMockProposal());

    await h.submissions.createProposal({
      action_type: 'customer.update',
      payload_json: { customer_id: 'c-1' },
      trace_id: 'trace-9',
    });

    expect(h.mockPrisma.agentProposal.create).toHaveBeenCalledWith({
      data: {
        tenant_id: tenantId,
        trace_id: 'trace-9',
        action_type: 'customer.update',
        payload_json: { customer_id: 'c-1' },
        preview_json: Prisma.JsonNull,
        tier: AgentPolicyTier.PROPOSE,
        status: AgentProposalStatus.PENDING,
      },
    });
  });

  it('generates a trace id when the caller does not supply one', async () => {
    h.mockPrisma.agentProposal.create.mockResolvedValue(createMockProposal());

    await h.submissions.createProposal({
      action_type: 'customer.update',
      payload_json: {},
    });

    expect(h.mockPrisma.agentProposal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        trace_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      }),
    });
  });

  it('persists a pending action without a creating agent unless one is given', async () => {
    h.mockPrisma.agentProposal.create.mockResolvedValue(createMockProposal());
    const input = {
      action_type: 'customer.update',
      payload_json: {},
      preview_json: { provisional: true },
      tier: AgentPolicyTier.PROPOSE,
      trace_id: traceId,
    };

    await h.submissions.persistPendingAction(input);
    expect(h.mockPrisma.agentProposal.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        created_by_agent: null,
        status: AgentProposalStatus.PENDING,
        trace_id: traceId,
      }),
    });

    await h.submissions.persistPendingAction({
      ...input,
      created_by_agent: 'agent-7',
    });
    expect(h.mockPrisma.agentProposal.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ created_by_agent: 'agent-7' }),
    });
  });

  it('simulates a PROPOSE action and stores the preview as provisional with no site', async () => {
    h.mockDryRun.executeInRollbackTransaction.mockResolvedValue({
      result: { id: 'c-1' },
      wouldChange: [{ type: 'update', entity: 'Customer' }],
    });
    h.mockPrisma.agentProposal.create.mockResolvedValue(createMockProposal());

    await h.submissions.submitPendingAction({
      action_type: 'customer.update',
      payload_json: { customer_id: 'c-1' },
    });

    expect(h.mockAgentActionLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'customer.update',
        status: 'PROPOSED',
        resultSummary: { would_change: [{ type: 'update', entity: 'Customer' }] },
      }),
    );
    const createdData = h.mockPrisma.agentProposal.create.mock.calls[0][0].data;
    expect(createdData.preview_json).toEqual({
      result: { id: 'c-1' },
      would_change: [{ type: 'update', entity: 'Customer' }],
      provisional: true,
    });
  });

  it('refuses to store a workshop order simulated in a site that is no longer active', async () => {
    h.mockDryRun.executeInRollbackTransaction.mockImplementation(async () => {
      h.mockSiteContext.getSiteId.mockResolvedValue('site-2');
      return { result: {}, wouldChange: [] };
    });

    await expect(
      h.submissions.submitPendingAction({
        action_type: 'workshop_order.create',
        payload_json: { status: 'SCHEDULED' },
      }),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(h.mockAgentActionLog.record).not.toHaveBeenCalled();
    expect(h.mockPrisma.agentProposal.create).not.toHaveBeenCalled();
  });

  it('rejects actions without an executor before simulating them', async () => {
    await expect(
      h.submissions.submitPendingAction({
        action_type: 'unknown.action',
        payload_json: {},
      }),
    ).rejects.toThrow(BadRequestException);
    expect(h.mockDryRun.executeInRollbackTransaction).not.toHaveBeenCalled();
  });
});
