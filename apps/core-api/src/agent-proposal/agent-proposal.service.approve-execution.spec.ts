import { BadRequestException, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { AgentPolicyTier, AgentProposalStatus, Prisma } from '@prisma/client';
import { AgentProposalService } from './agent-proposal.service.js';
import { createAgentProposalSpecHarness, createMockProposal, proposalId, tenantId, userId } from './agent-proposal.spec.support.js';

describe('AgentProposalService approve execution', () => {
  let service: AgentProposalService;
  let mockPrisma: any;
  let mockAgentPolicyService: any;
  let mockAgentActionLog: any;

  beforeEach(() => {
    ({ service, mockPrisma, mockAgentPolicyService, mockAgentActionLog } = createAgentProposalSpecHarness());
  });

  describe('approveProposal: state guards, failures and dispatch', () => {
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
      mockPrisma.workshopOrder.findFirst.mockRejectedValueOnce(
        new Error('Dispatch failure'),
      );

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Dispatch failure',
      );

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenLastCalledWith({
        where: {
          id: proposalId,
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
        },
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
      expect(mockAgentActionLog.recordInTransaction).not.toHaveBeenCalled();
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
        where: { id: 'wo-1', tenant_id: tenantId, site_id: 'site-1' },
        include: {
          tasks: {
            where: {
              tenant_id: tenantId,
              workshop_order: { tenant_id: tenantId, site_id: 'site-1' },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      const lineItemCreate = mockPrisma.workshopTaskLineItem.create.mock.calls[0][0];
      expect(lineItemCreate).toMatchObject({
        data: {
          tenant_id: tenantId,
          workshop_task_id: 'task-1',
          type: 'PART',
          item_no: 'OIL-FILTER-01',
          description: 'Engine Oil Filter',
          quantity: expect.any(Prisma.Decimal),
          unit_price: expect.any(Prisma.Decimal),
          part_execution_status: 'PENDING_PICK',
          labor_operation_id: null,
        },
        select: { id: true },
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
        select: { id: true, email: true },
      });

      expect(mockPrisma.customer.updateMany).toHaveBeenCalledWith({
        where: { id: 'cust-1', tenant_id: tenantId },
        data: {
          first_name: 'Jane',
          phone: '+49123456789',
          phone_digits: '49123456789',
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
        where: {
          id: proposalId,
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
        },
        data: {
          status: AgentProposalStatus.FAILED,
          reason:
            'Unsupported action type for automatic execution: unsupported.action_type',
        },
      });
    });

  });
});
