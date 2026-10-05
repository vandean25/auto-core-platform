import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AgentPolicyTier, AgentProposalStatus, Prisma } from '@prisma/client';
import { AgentProposalService } from './agent-proposal.service.js';

describe('AgentProposalService', () => {
  const tenantId = '00000000-0000-0000-0000-000000000001';
  const userId = '00000000-0000-0000-0000-000000000002';
  const proposalId = '11111111-1111-1111-1111-111111111111';
  const traceId = '22222222-2222-2222-2222-222222222222';

  let service: AgentProposalService;
  let mockPrisma: any;
  let mockTenantContext: any;
  let mockAgentPolicyService: any;
  let mockAgentActionLog: any;

  beforeEach(() => {
    mockTenantContext = {
      getTenantId: jest.fn().mockResolvedValue(tenantId),
      getAuthenticatedUser: jest.fn().mockReturnValue({
        userId: 'fb-user-1',
        email: 'supervisor@example.com',
        tenantId,
        role: 'ADMIN',
      }),
    };

    mockPrisma = {
      agentProposal: {
        updateMany: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: userId }),
      },
      tenantMember: {
        findFirst: jest.fn().mockResolvedValue({ id: 'tm-1' }),
      },
      workshopOrder: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'wo-1',
          tasks: [{ id: 'task-1' }],
        }),
      },
      workshopTask: {
        create: jest.fn().mockResolvedValue({ id: 'task-1' }),
      },
      workshopTaskLineItem: {
        create: jest.fn().mockResolvedValue({ id: 'line-1' }),
      },
      customer: {
        findFirst: jest.fn().mockResolvedValue({ id: 'cust-1' }),
        update: jest.fn().mockResolvedValue({ id: 'cust-1' }),
      },
    };

    mockAgentPolicyService = {
      evaluate: jest.fn().mockResolvedValue({
        tier: AgentPolicyTier.PROPOSE,
        reasons: ['base_tier_propose'],
        rule_id: 'rule-1',
        rule_version: 1,
      }),
    };

    mockAgentActionLog = {
      record: jest.fn().mockImplementation(async (_input, work) => {
        let workResult;
        if (work) {
          workResult = await work();
        }
        return { id: 'log-1', traceId, workResult };
      }),
    };

    service = new AgentProposalService(
      mockPrisma,
      mockTenantContext,
      mockAgentPolicyService,
      mockAgentActionLog,
    );
  });

  const createMockProposal = (overrides?: Partial<any>) => ({
    id: proposalId,
    tenant_id: tenantId,
    trace_id: traceId,
    action_type: 'workshop_order.add_line',
    payload_json: { order_id: 'wo-1', amount_eur: 50 },
    preview_json: null,
    tier: AgentPolicyTier.PROPOSE,
    status: AgentProposalStatus.PENDING,
    decided_by: null,
    decided_at: null,
    reason: null,
    expires_at: new Date(Date.now() + 1000 * 60 * 60), // +1 hour
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  describe('listProposals', () => {
    it('lazily expires pending proposals past expiration and returns proposals', async () => {
      const proposal = createMockProposal();
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.agentProposal.findMany.mockResolvedValue([proposal]);

      const result = await service.listProposals({});

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenCalledWith({
        where: {
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
          expires_at: { lt: expect.any(Date) },
        },
        data: { status: AgentProposalStatus.EXPIRED },
      });

      expect(mockPrisma.agentProposal.findMany).toHaveBeenCalledWith({
        where: {
          tenant_id: tenantId,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 50,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(proposalId);
    });

    it('filters proposals by status and enforces tenant isolation', async () => {
      const pendingProposal = createMockProposal({
        status: AgentProposalStatus.PENDING,
      });
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.agentProposal.findMany.mockResolvedValue([pendingProposal]);

      const result = await service.listProposals({
        status: AgentProposalStatus.PENDING,
        limit: 15,
      });

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenant_id: tenantId,
          }),
        }),
      );

      expect(mockPrisma.agentProposal.findMany).toHaveBeenCalledWith({
        where: {
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 15,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].status).toBe(AgentProposalStatus.PENDING);
    });
  });

  describe('getProposalById', () => {
    it('returns proposal for the current tenant', async () => {
      const proposal = createMockProposal();
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);

      const result = await service.getProposalById(proposalId);

      expect(mockPrisma.agentProposal.findFirst).toHaveBeenCalledWith({
        where: { id: proposalId, tenant_id: tenantId },
      });
      expect(result.id).toBe(proposalId);
    });

    it('throws NotFoundException when proposal does not exist or belongs to another tenant', async () => {
      mockPrisma.agentProposal.findFirst.mockResolvedValue(null);

      await expect(service.getProposalById(proposalId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lazily marks PENDING proposal as EXPIRED when past expires_at', async () => {
      const expiredProposal = createMockProposal({
        status: AgentProposalStatus.PENDING,
        expires_at: new Date(Date.now() - 1000 * 60),
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(expiredProposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.getProposalById(proposalId);

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenCalledWith({
        where: {
          id: proposalId,
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
        },
        data: { status: AgentProposalStatus.EXPIRED },
      });
      expect(result.status).toBe(AgentProposalStatus.EXPIRED);
    });
  });

  describe('rejectProposal', () => {
    it('saves reason, transitions to REJECTED, logs via AE2, and does NOT dispatch action payload', async () => {
      const proposal = createMockProposal();
      mockPrisma.agentProposal.findFirst
        .mockResolvedValueOnce(proposal)
        .mockResolvedValueOnce({
          ...proposal,
          status: AgentProposalStatus.REJECTED,
          decided_by: userId,
          decided_at: new Date(),
          reason: 'Too expensive',
        });
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.rejectProposal(proposalId, {
        reason: 'Too expensive',
      });

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenCalledWith({
        where: {
          id: proposalId,
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
          expires_at: { gt: expect.any(Date) },
        },
        data: {
          status: AgentProposalStatus.REJECTED,
          decided_by: userId,
          decided_at: expect.any(Date),
          reason: 'Too expensive',
        },
      });

      expect(mockAgentActionLog.record).toHaveBeenCalledTimes(1);
      expect(mockAgentActionLog.record).toHaveBeenCalledWith({
        traceId,
        actorType: 'USER',
        onBehalfOfUserId: userId,
        actionType: 'workshop_order.add_line',
        tier: 'PROPOSE',
        status: 'REJECTED',
        inputSummary: { proposalId: proposal.id, reason: 'Too expensive' },
        resultSummary: { rejectedBy: userId, reason: 'Too expensive' },
      });

      // Verify no work/dispatch callback was passed to record
      const recordCalls = mockAgentActionLog.record.mock.calls;
      expect(recordCalls[0][1]).toBeUndefined();

      expect(result.status).toBe(AgentProposalStatus.REJECTED);
      expect(result.reason).toBe('Too expensive');
    });

    it('returns existing proposal idempotently if already REJECTED', async () => {
      const proposal = createMockProposal({
        status: AgentProposalStatus.REJECTED,
        reason: 'Already rejected',
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);

      const result = await service.rejectProposal(proposalId);

      expect(result.status).toBe(AgentProposalStatus.REJECTED);
      expect(mockPrisma.agentProposal.updateMany).not.toHaveBeenCalled();
    });

    it('returns existing proposal idempotently even after expiration if already REJECTED', async () => {
      const expiredProposal = createMockProposal({
        status: AgentProposalStatus.REJECTED,
        reason: 'Already rejected earlier',
        expires_at: new Date(Date.now() - 1000 * 60 * 60), // expired 1 hour ago
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(expiredProposal);

      const result = await service.rejectProposal(proposalId);

      expect(result.status).toBe(AgentProposalStatus.REJECTED);
      expect(mockPrisma.agentProposal.updateMany).not.toHaveBeenCalled();
      expect(mockAgentActionLog.record).not.toHaveBeenCalled();
    });

    it('throws ConflictException if already APPROVED or EXECUTED', async () => {
      const proposal = createMockProposal({
        status: AgentProposalStatus.APPROVED,
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);

      await expect(service.rejectProposal(proposalId)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws ConflictException if status is FAILED', async () => {
      const proposal = createMockProposal({
        status: AgentProposalStatus.FAILED,
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);

      await expect(service.rejectProposal(proposalId)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws UnprocessableEntityException if expired while PENDING', async () => {
      const proposal = createMockProposal({
        expires_at: new Date(Date.now() - 1000), // past
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.rejectProposal(proposalId)).rejects.toThrow(
        UnprocessableEntityException,
      );

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenCalledWith({
        where: {
          id: proposalId,
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
        },
        data: { status: AgentProposalStatus.EXPIRED },
      });
    });

    it('handles concurrent rejection idempotency when reload returns REJECTED', async () => {
      const pendingProposal = createMockProposal({
        status: AgentProposalStatus.PENDING,
      });
      const rejectedProposal = createMockProposal({
        status: AgentProposalStatus.REJECTED,
        reason: 'Concurrent rejection',
      });
      mockPrisma.agentProposal.findFirst
        .mockResolvedValueOnce(pendingProposal)
        .mockResolvedValueOnce(rejectedProposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.rejectProposal(proposalId, {
        reason: 'My rejection',
      });

      expect(result.status).toBe(AgentProposalStatus.REJECTED);
      expect(mockAgentActionLog.record).not.toHaveBeenCalled();
    });
  });

  describe('approveProposal', () => {
    it('re-evaluates policy, atomically locks, executes payload, logs action, and marks EXECUTED', async () => {
      const proposal = createMockProposal();
      mockPrisma.agentProposal.findFirst
        .mockResolvedValueOnce(proposal)
        .mockResolvedValueOnce({
          ...proposal,
          status: AgentProposalStatus.EXECUTED,
          decided_by: userId,
          decided_at: new Date(),
        });
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.approveProposal(proposalId);

      expect(mockAgentPolicyService.evaluate).toHaveBeenCalledWith(
        {
          action_type: 'workshop_order.add_line',
          context: { amount_eur: 50 },
        },
        { skipAdminCheck: true },
      );

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenNthCalledWith(
        1,
        {
          where: {
            id: proposalId,
            tenant_id: tenantId,
            status: AgentProposalStatus.PENDING,
            expires_at: { gt: expect.any(Date) },
          },
          data: {
            status: AgentProposalStatus.APPROVED,
            decided_by: userId,
            decided_at: expect.any(Date),
          },
        },
      );

      expect(mockAgentActionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          traceId,
          actorType: 'USER',
          onBehalfOfUserId: userId,
          actionType: 'workshop_order.add_line',
          status: 'EXECUTED',
        }),
        expect.any(Function),
      );

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenNthCalledWith(
        2,
        {
          where: { id: proposalId, tenant_id: tenantId },
          data: { status: AgentProposalStatus.EXECUTED },
        },
      );

      expect(result.status).toBe(AgentProposalStatus.EXECUTED);
    });

    it('refuses approval when policy re-evaluation returns HUMAN_ONLY with clear message', async () => {
      const proposal = createMockProposal();
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockAgentPolicyService.evaluate.mockResolvedValue({
        tier: AgentPolicyTier.HUMAN_ONLY,
        reasons: ['rule_disabled_fail_closed', 'sensitive_operation'],
        rule_id: 'rule-1',
        rule_version: 2,
      });

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        new UnprocessableEntityException(
          'Action requires human execution or exceeds policy limits: rule_disabled_fail_closed, sensitive_operation',
        ),
      );

      expect(mockPrisma.agentProposal.updateMany).not.toHaveBeenCalled();
      expect(mockAgentActionLog.record).not.toHaveBeenCalled();
    });

    it('refuses approval when context amount_eur exceeds updated condition threshold', async () => {
      const proposal = createMockProposal({
        payload_json: { amount_eur: 500 },
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockAgentPolicyService.evaluate.mockResolvedValue({
        tier: AgentPolicyTier.HUMAN_ONLY,
        reasons: ['amount_eur_exceeds_threshold'],
        rule_id: 'rule-2',
        rule_version: 1,
      });

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        new UnprocessableEntityException(
          'Action requires human execution or exceeds policy limits: amount_eur_exceeds_threshold',
        ),
      );

      expect(mockAgentPolicyService.evaluate).toHaveBeenCalledWith(
        {
          action_type: 'workshop_order.add_line',
          context: { amount_eur: 500 },
        },
        { skipAdminCheck: true },
      );
      expect(mockPrisma.agentProposal.updateMany).not.toHaveBeenCalled();
      expect(mockAgentActionLog.record).not.toHaveBeenCalled();
    });

    it('handles concurrent double-approve race condition idempotently when reload returns EXECUTED (payload dispatched once)', async () => {
      const pendingProposal = createMockProposal({
        status: AgentProposalStatus.PENDING,
      });
      const executedProposal = createMockProposal({
        status: AgentProposalStatus.EXECUTED,
        decided_by: 'concurrent-user',
        decided_at: new Date(),
      });

      mockPrisma.agentProposal.findFirst
        .mockResolvedValueOnce(pendingProposal)
        .mockResolvedValueOnce(executedProposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.approveProposal(proposalId);

      expect(result.status).toBe(AgentProposalStatus.EXECUTED);
      // Payload execution and logging were NOT dispatched by the concurrent caller
      expect(mockAgentActionLog.record).not.toHaveBeenCalled();
    });

    it('handles concurrent double-approve race condition idempotently when reload returns APPROVED', async () => {
      const pendingProposal = createMockProposal({
        status: AgentProposalStatus.PENDING,
      });
      const approvedProposal = createMockProposal({
        status: AgentProposalStatus.APPROVED,
        decided_by: 'concurrent-user',
        decided_at: new Date(),
      });

      mockPrisma.agentProposal.findFirst
        .mockResolvedValueOnce(pendingProposal)
        .mockResolvedValueOnce(approvedProposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.approveProposal(proposalId);

      expect(result.status).toBe(AgentProposalStatus.APPROVED);
      expect(mockAgentActionLog.record).not.toHaveBeenCalled();
    });

    it('throws ConflictException on concurrent race condition if reload returns unexpected status', async () => {
      const pendingProposal = createMockProposal({
        status: AgentProposalStatus.PENDING,
      });
      const rejectedProposal = createMockProposal({
        status: AgentProposalStatus.REJECTED,
        decided_by: 'concurrent-user',
        decided_at: new Date(),
      });

      mockPrisma.agentProposal.findFirst
        .mockResolvedValueOnce(pendingProposal)
        .mockResolvedValueOnce(rejectedProposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        new ConflictException(
          'Proposal state conflict: current status is REJECTED',
        ),
      );
      expect(mockAgentActionLog.record).not.toHaveBeenCalled();
    });

    it('returns existing proposal idempotently if already APPROVED or EXECUTED', async () => {
      const proposal = createMockProposal({
        status: AgentProposalStatus.EXECUTED,
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);

      const result = await service.approveProposal(proposalId);

      expect(result.status).toBe(AgentProposalStatus.EXECUTED);
      expect(mockAgentPolicyService.evaluate).not.toHaveBeenCalled();
    });

    it('returns already EXECUTED proposal idempotently even after expiration without throwing 422', async () => {
      const expiredExecutedProposal = createMockProposal({
        status: AgentProposalStatus.EXECUTED,
        expires_at: new Date(Date.now() - 1000 * 60 * 60), // expired 1 hour ago
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(
        expiredExecutedProposal,
      );

      const result = await service.approveProposal(proposalId);

      expect(result.status).toBe(AgentProposalStatus.EXECUTED);
      expect(mockAgentPolicyService.evaluate).not.toHaveBeenCalled();
      expect(mockPrisma.agentProposal.updateMany).not.toHaveBeenCalled();
    });

    it('returns already APPROVED proposal idempotently even after expiration without throwing 422', async () => {
      const expiredApprovedProposal = createMockProposal({
        status: AgentProposalStatus.APPROVED,
        expires_at: new Date(Date.now() - 1000 * 60 * 60),
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(
        expiredApprovedProposal,
      );

      const result = await service.approveProposal(proposalId);

      expect(result.status).toBe(AgentProposalStatus.APPROVED);
      expect(mockAgentPolicyService.evaluate).not.toHaveBeenCalled();
      expect(mockPrisma.agentProposal.updateMany).not.toHaveBeenCalled();
    });

    it('throws ConflictException if status is REJECTED or FAILED', async () => {
      const proposal = createMockProposal({
        status: AgentProposalStatus.REJECTED,
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        ConflictException,
      );
    });

    it('marks as FAILED and rethrows if payload execution fails', async () => {
      const proposal = createMockProposal();
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });
      mockAgentActionLog.record.mockRejectedValue(
        new Error('Dispatch failure'),
      );

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Dispatch failure',
      );

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenLastCalledWith({
        where: { id: proposalId, tenant_id: tenantId },
        data: {
          status: AgentProposalStatus.FAILED,
          reason: 'Dispatch failure',
        },
      });
    });

    it('throws UnprocessableEntityException if expired while PENDING', async () => {
      const proposal = createMockProposal({
        expires_at: new Date(Date.now() - 5000),
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('normalizes amount_cents and amountCents to amount_eur by dividing by 100 in extractPolicyContext', async () => {
      const proposal = createMockProposal({
        payload_json: { order_id: 'wo-1', amount_cents: 25000 },
      });
      mockPrisma.agentProposal.findFirst
        .mockResolvedValueOnce(proposal)
        .mockResolvedValueOnce({
          ...proposal,
          status: AgentProposalStatus.EXECUTED,
          decided_by: userId,
          decided_at: new Date(),
        });
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });

      await service.approveProposal(proposalId);

      expect(mockAgentPolicyService.evaluate).toHaveBeenCalledWith(
        {
          action_type: 'workshop_order.add_line',
          context: { amount_eur: 250 },
        },
        { skipAdminCheck: true },
      );
    });

    it('refuses approval when payload amount_cents exceeds policy conditions threshold', async () => {
      const proposal = createMockProposal({
        payload_json: { order_id: 'wo-1', amount_cents: 60000 }, // 600 EUR
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockAgentPolicyService.evaluate.mockResolvedValue({
        tier: AgentPolicyTier.HUMAN_ONLY,
        reasons: ['amount_above_threshold'],
        rule_id: 'rule-cents',
        rule_version: 1,
      });

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        new UnprocessableEntityException(
          'Action requires human execution or exceeds policy limits: amount_above_threshold',
        ),
      );

      expect(mockAgentPolicyService.evaluate).toHaveBeenCalledWith(
        {
          action_type: 'workshop_order.add_line',
          context: { amount_eur: 600 },
        },
        { skipAdminCheck: true },
      );
      expect(mockPrisma.agentProposal.updateMany).not.toHaveBeenCalled();
    });

    it('throws UnprocessableEntityException when CAS updateMany returns 0 because proposal expired during policy evaluation', async () => {
      const proposal = createMockProposal({
        expires_at: new Date(Date.now() + 1000), // initially valid
      });
      const expiredProposal = createMockProposal({
        expires_at: new Date(Date.now() - 1000), // now expired
      });

      mockPrisma.agentProposal.findFirst
        .mockResolvedValueOnce(proposal)
        .mockResolvedValueOnce(expiredProposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 0 }); // CAS lock returned 0

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        new UnprocessableEntityException('Proposal has expired'),
      );

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenCalledWith({
        where: {
          id: proposalId,
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
        },
        data: { status: AgentProposalStatus.EXPIRED },
      });
      expect(mockAgentActionLog.record).not.toHaveBeenCalled();
    });

    it('dispatches workshop_order.add_line domain action, creates WorkshopTaskLineItem, and marks EXECUTED', async () => {
      const proposal = createMockProposal({
        payload_json: {
          order_id: 'wo-1',
          task_id: 'task-1',
          type: 'PART',
          item_no: 'OIL-FILTER-01',
          description: 'Engine Oil Filter',
          quantity: 2,
          unit_price: 15.5,
        },
      });
      mockPrisma.agentProposal.findFirst
        .mockResolvedValueOnce(proposal)
        .mockResolvedValueOnce({
          ...proposal,
          status: AgentProposalStatus.EXECUTED,
          decided_by: userId,
          decided_at: new Date(),
        });
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.approveProposal(proposalId);

      expect(mockPrisma.workshopOrder.findFirst).toHaveBeenCalledWith({
        where: { id: 'wo-1', tenant_id: tenantId },
        include: {
          tasks: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      expect(mockPrisma.workshopTaskLineItem.create).toHaveBeenCalledWith({
        data: {
          tenant_id: tenantId,
          workshop_task_id: 'task-1',
          type: 'PART',
          item_no: 'OIL-FILTER-01',
          description: 'Engine Oil Filter',
          quantity: expect.any(Prisma.Decimal),
          unit_price: expect.any(Prisma.Decimal),
        },
      });

      expect(result.status).toBe(AgentProposalStatus.EXECUTED);
    });

    it('dispatches customer.update domain action, updates Customer, and marks EXECUTED', async () => {
      const proposal = createMockProposal({
        action_type: 'customer.update',
        payload_json: {
          customer_id: 'cust-1',
          first_name: 'Jane',
          phone: '+49123456789',
        },
      });
      mockPrisma.agentProposal.findFirst
        .mockResolvedValueOnce(proposal)
        .mockResolvedValueOnce({
          ...proposal,
          status: AgentProposalStatus.EXECUTED,
          decided_by: userId,
          decided_at: new Date(),
        });
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.approveProposal(proposalId);

      expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith({
        where: { id: 'cust-1', tenant_id: tenantId },
      });

      expect(mockPrisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        data: {
          first_name: 'Jane',
          phone: '+49123456789',
        },
      });

      expect(result.status).toBe(AgentProposalStatus.EXECUTED);
    });

    it('fails closed with BadRequestException for unsupported action types, marks proposal FAILED and logs failure', async () => {
      const proposal = createMockProposal({
        action_type: 'unsupported.action_type',
        payload_json: { some_param: 123 },
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Unsupported action type for automatic execution: unsupported.action_type',
      );

      // Proposal must be marked FAILED with reason, NOT EXECUTED
      expect(mockPrisma.agentProposal.updateMany).toHaveBeenLastCalledWith({
        where: { id: proposalId, tenant_id: tenantId },
        data: {
          status: AgentProposalStatus.FAILED,
          reason: 'Unsupported action type for automatic execution: unsupported.action_type',
        },
      });
    });

    it('marks proposal FAILED with reason when domain execution fails (e.g. order not found)', async () => {
      const proposal = createMockProposal({
        action_type: 'workshop_order.add_line',
        payload_json: { order_id: 'non-existent-order' },
      });
      mockPrisma.workshopOrder.findFirst.mockResolvedValueOnce(null);
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Workshop order non-existent-order not found',
      );

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenLastCalledWith({
        where: { id: proposalId, tenant_id: tenantId },
        data: {
          status: AgentProposalStatus.FAILED,
          reason: 'Workshop order non-existent-order not found',
        },
      });
    });
  });

  describe('createProposal', () => {
    it('creates a new proposal in PENDING status', async () => {
      const proposal = createMockProposal();
      mockPrisma.agentProposal.create.mockResolvedValue(proposal);

      const result = await service.createProposal({
        action_type: 'workshop_order.add_line',
        payload_json: { amount_eur: 50 },
      });

      expect(mockPrisma.agentProposal.create).toHaveBeenCalledWith({
        data: {
          tenant_id: tenantId,
          trace_id: expect.any(String),
          action_type: 'workshop_order.add_line',
          payload_json: { amount_eur: 50 },
          preview_json: Prisma.JsonNull,
          tier: AgentPolicyTier.PROPOSE,
          status: AgentProposalStatus.PENDING,
        },
      });

      expect(result.id).toBe(proposalId);
    });
  });
});
