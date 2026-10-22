import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AgentPolicyTier, AgentProposalStatus } from '@prisma/client';
import {
  createAgentProposalSpecHarness,
  createMockProposal,
  proposalId,
  tenantId,
  userId,
} from './agent-proposal.spec.support.js';

describe('AgentProposalDecisionService', () => {
  let h: ReturnType<typeof createAgentProposalSpecHarness>;

  beforeEach(() => {
    h = createAgentProposalSpecHarness();
  });

  it('refuses decisions from roles without supervision access, before reading the proposal', async () => {
    h.mockTenantContext.getAuthenticatedUser.mockReturnValue({
      userId: 'fb-user-2',
      tenantId,
      role: 'TECH',
    });

    await expect(h.decisions.approveProposal(proposalId)).rejects.toThrow(
      ForbiddenException,
    );
    expect(h.mockPrisma.agentProposal.findFirst).not.toHaveBeenCalled();
  });

  it('reports a proposal outside this tenant as not found', async () => {
    h.mockPrisma.agentProposal.findFirst.mockResolvedValue(null);

    await expect(
      h.decisions.rejectProposal('missing-id', { reason: 'n/a' }),
    ).rejects.toThrow(NotFoundException);
    expect(h.mockPrisma.agentProposal.findFirst).toHaveBeenCalledWith({
      where: { id: 'missing-id', tenant_id: tenantId },
    });
  });

  it('marks a pending proposal past its deadline as EXPIRED instead of approving it', async () => {
    h.mockPrisma.agentProposal.findFirst.mockResolvedValue(
      createMockProposal({ expires_at: new Date(Date.now() - 1000) }),
    );

    await expect(h.decisions.approveProposal(proposalId)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(h.mockPrisma.agentProposal.updateMany).toHaveBeenCalledWith({
      where: {
        id: proposalId,
        tenant_id: tenantId,
        status: AgentProposalStatus.PENDING,
      },
      data: { status: AgentProposalStatus.EXPIRED },
    });
    expect(h.mockAgentPolicyService.evaluate).not.toHaveBeenCalled();
  });

  it('returns an already executed proposal without resolving its executor again', async () => {
    const resolveSpy = jest.spyOn(h.mockPendingActionExecutors, 'resolve');
    h.mockPrisma.agentProposal.findFirst.mockResolvedValue(
      createMockProposal({
        status: AgentProposalStatus.EXECUTED,
        decided_by: userId,
        decided_at: new Date(),
      }),
    );

    const result = await h.decisions.approveProposal(proposalId);

    expect(result.status).toBe(AgentProposalStatus.EXECUTED);
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(h.mockPrisma.agentProposal.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a pending proposal with the reason and the decider, then reports the rejected state', async () => {
    h.mockPrisma.agentProposal.findFirst
      .mockResolvedValueOnce(createMockProposal())
      .mockResolvedValueOnce(
        createMockProposal({
          status: AgentProposalStatus.REJECTED,
          decided_by: userId,
          reason: 'duplicate',
        }),
      );
    h.mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });

    const result = await h.decisions.rejectProposal(proposalId, {
      reason: 'duplicate',
    });

    expect(h.mockPrisma.agentProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: AgentProposalStatus.REJECTED,
          decided_by: userId,
          reason: 'duplicate',
        }),
      }),
    );
    expect(result.status).toBe(AgentProposalStatus.REJECTED);
  });

  it('refuses to reject a proposal that was already approved', async () => {
    h.mockPrisma.agentProposal.findFirst.mockResolvedValue(
      createMockProposal({ status: AgentProposalStatus.APPROVED }),
    );

    await expect(h.decisions.rejectProposal(proposalId)).rejects.toThrow(
      ConflictException,
    );
    await expect(h.decisions.rejectProposal(proposalId)).rejects.toThrow(
      'Proposal is already approved',
    );
    expect(h.mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses approval of HUMAN_ONLY proposals before evaluating policy', async () => {
    h.mockPrisma.agentProposal.findFirst.mockResolvedValue(
      createMockProposal({ tier: AgentPolicyTier.HUMAN_ONLY }),
    );

    await expect(h.decisions.approveProposal(proposalId)).rejects.toThrow(
      UnprocessableEntityException,
    );
    await expect(h.decisions.approveProposal(proposalId)).rejects.toThrow(
      'HUMAN_ONLY proposals must be performed manually',
    );
    expect(h.mockAgentPolicyService.evaluate).not.toHaveBeenCalled();
  });

  it('refuses site-bound approval when the active site differs from the simulation site', async () => {
    h.mockSiteContext.getSiteId.mockResolvedValue('site-2');
    h.mockPrisma.agentProposal.findFirst.mockResolvedValue(
      createMockProposal({
        action_type: 'workshop.booking_package',
        preview_json: { execution_context: { site_id: 'site-1' } },
      }),
    );

    await expect(h.decisions.approveProposal(proposalId)).rejects.toThrow(
      'Select the site where this action was simulated before applying it',
    );
    expect(h.mockPrisma.agentProposal.updateMany).not.toHaveBeenCalled();
  });

  it('passes the simulated site into the executor for site-bound workshop order creation', async () => {
    const executeSpy = jest
      .spyOn(h.mockPendingActionExecutors, 'resolve')
      .mockReturnValue({
        actionType: 'workshop_order.create',
        buildPolicyContext: () => Promise.resolve({}),
        execute: jest.fn().mockResolvedValue({ id: 'order-1' }),
        buildResultSummary: () => ({}),
      });
    h.mockPrisma.agentProposal.findFirst
      .mockResolvedValueOnce(
        createMockProposal({
          action_type: 'workshop_order.create',
          preview_json: { execution_context: { site_id: 'site-1' } },
        }),
      )
      .mockResolvedValueOnce(
        createMockProposal({
          action_type: 'workshop_order.create',
          status: AgentProposalStatus.EXECUTED,
          decided_by: userId,
        }),
      );
    h.mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });

    await h.decisions.approveProposal(proposalId);

    const executor = executeSpy.mock.results[0]?.value;
    expect(executor.execute).toHaveBeenCalledWith(
      expect.anything(),
      { site_id: 'site-1' },
    );
  });

  it('marks an unsupported action as FAILED before rethrowing', async () => {
    jest.spyOn(h.mockPendingActionExecutors, 'resolve').mockImplementation(() => {
      throw new BadRequestException('Unsupported action type');
    });
    h.mockPrisma.agentProposal.findFirst.mockResolvedValue(createMockProposal());
    h.mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });

    await expect(h.decisions.approveProposal(proposalId)).rejects.toThrow(
      BadRequestException,
    );

    expect(h.mockPrisma.agentProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: AgentProposalStatus.FAILED,
          reason: 'Unsupported action type',
        }),
      }),
    );
  });

  it('logs when audit persistence for a failed execution cannot be stored', async () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const execute = jest.fn().mockRejectedValue(new Error('execute failed'));
    jest.spyOn(h.mockPendingActionExecutors, 'resolve').mockReturnValue({
      actionType: 'workshop_order.add_line',
      buildPolicyContext: () => Promise.resolve({}),
      execute,
      buildResultSummary: () => ({}),
    });
    h.mockPrisma.agentProposal.findFirst.mockResolvedValue(createMockProposal());
    h.mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });
    let transactionCalls = 0;
    h.mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => {
        transactionCalls += 1;
        if (transactionCalls === 1) {
          return callback(h.mockPrisma);
        }
        throw new Error('audit storage unavailable');
      },
    );

    await expect(h.decisions.approveProposal(proposalId)).rejects.toThrow(
      'execute failed',
    );

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
