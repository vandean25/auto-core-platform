import { ConflictException } from '@nestjs/common';
import { AgentProposalStatus, WorkshopOrderPurpose, WorkshopOrderStatus } from '@prisma/client';
import { AgentProposalService } from './agent-proposal.service.js';
import { createAgentProposalSpecHarness, createMockProposal, proposalId, tenantId, userId } from './agent-proposal.spec.support.js';

describe('AgentProposalService approve lines', () => {
  let service: AgentProposalService;
  let mockPrisma: any;
  let mockAgentPolicyService: any;

  beforeEach(() => {
    ({ service, mockPrisma, mockAgentPolicyService } = createAgentProposalSpecHarness());
  });

  describe('approveProposal: workshop line items', () => {
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
        where: {
          id: proposalId,
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
        },
        data: {
          status: AgentProposalStatus.FAILED,
          reason: 'Workshop order non-existent-order not found',
        },
      });
    });

    it('rejects workshop_order.add_line when payload site_id does not match caller authorized site', async () => {
      const proposal = createMockProposal({
        action_type: 'workshop_order.add_line',
        payload_json: {
          order_id: 'wo-1',
          site_id: 'other-site-999',
        },
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Action payload site (other-site-999) does not match caller authorized site (site-1)',
      );

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenLastCalledWith({
        where: {
          id: proposalId,
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
        },
        data: {
          status: AgentProposalStatus.FAILED,
          reason:
            'Action payload site (other-site-999) does not match caller authorized site (site-1)',
        },
      });
    });

    it('rejects workshop_order.add_line when payload amount contradicts unit_price * quantity', async () => {
      const proposal = createMockProposal({
        action_type: 'workshop_order.add_line',
        payload_json: {
          order_id: 'wo-1',
          unit_price: 600,
          quantity: 1,
          amount_eur: 50,
        },
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Payload amount (50) contradicts unit_price (600) * quantity (1) = 600',
      );
    });

    it('evaluates policy with unit_price * quantity when amount_eur is omitted', async () => {
      const proposal = createMockProposal({
        action_type: 'workshop_order.add_line',
        payload_json: {
          order_id: 'wo-1',
          unit_price: 300,
          quantity: 2,
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

      await service.approveProposal(proposalId);

      expect(mockAgentPolicyService.evaluate).toHaveBeenCalledWith(
        {
          action_type: 'workshop_order.add_line',
          context: {
            amount_eur: 600,
          },
        },
        { skipAdminCheck: true },
      );
    });

    it('rejects workshop_order.add_line when unit_price is negative', async () => {
      const proposal = createMockProposal({
        action_type: 'workshop_order.add_line',
        payload_json: {
          order_id: 'wo-1',
          unit_price: -100,
          quantity: 1,
        },
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Line item unit_price cannot be negative',
      );
    });

    it('rejects workshop_order.add_line when amount_eur is negative', async () => {
      const proposal = createMockProposal({
        action_type: 'workshop_order.add_line',
        payload_json: {
          order_id: 'wo-1',
          amount_eur: -50,
          quantity: 1,
        },
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Line item amount cannot be negative',
      );
    });

    it('rejects workshop_order.add_line when quantity is zero or negative', async () => {
      const zeroQtyProposal = createMockProposal({
        action_type: 'workshop_order.add_line',
        payload_json: {
          order_id: 'wo-1',
          unit_price: 50,
          quantity: 0,
        },
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(zeroQtyProposal);

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Line item quantity must be a positive number',
      );

      const negativeQtyProposal = createMockProposal({
        action_type: 'workshop_order.add_line',
        payload_json: {
          order_id: 'wo-1',
          unit_price: 50,
          quantity: -2,
        },
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(negativeQtyProposal);

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Line item quantity must be a positive number',
      );
    });

    it('rejects workshop_order.add_line when workshop order is already invoiced', async () => {
      const proposal = createMockProposal({
        action_type: 'workshop_order.add_line',
        payload_json: {
          order_id: 'wo-1',
          unit_price: 50,
          quantity: 1,
        },
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.workshopOrder.findFirst.mockResolvedValueOnce({
        id: 'wo-1',
        status: WorkshopOrderStatus.INVOICED,
        purpose: null,
        tasks: [{ id: 'task-1', line_items_version: 0 }],
      });

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Workshop order is already invoiced',
      );

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenLastCalledWith({
        where: {
          id: proposalId,
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
        },
        data: {
          status: AgentProposalStatus.FAILED,
          reason: 'Workshop order is already invoiced',
        },
      });
    });

    it('rejects workshop_order.add_line when stock-prep order is completed', async () => {
      const proposal = createMockProposal({
        action_type: 'workshop_order.add_line',
        payload_json: {
          order_id: 'wo-1',
          unit_price: 50,
          quantity: 1,
        },
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.workshopOrder.findFirst.mockResolvedValueOnce({
        id: 'wo-1',
        status: WorkshopOrderStatus.COMPLETED,
        purpose: WorkshopOrderPurpose.STOCK_PREP,
        tasks: [{ id: 'task-1', line_items_version: 0 }],
      });

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Completed stock-prep orders cannot be edited',
      );

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenLastCalledWith({
        where: {
          id: proposalId,
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
        },
        data: {
          status: AgentProposalStatus.FAILED,
          reason: 'Completed stock-prep orders cannot be edited',
        },
      });
    });

    it('throws ConflictException when task line_items_version CAS fails', async () => {
      const proposal = createMockProposal({
        action_type: 'workshop_order.add_line',
        payload_json: {
          order_id: 'wo-1',
          task_id: 'task-1',
          expected_line_items_version: 2,
          unit_price: 50,
          quantity: 1,
        },
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.workshopTask.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Workshop task line items changed; please reload and retry',
      );

      expect(mockPrisma.workshopTask.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'task-1',
          tenant_id: tenantId,
          workshop_order: { site_id: 'site-1' },
          line_items_version: 2,
        },
        data: { line_items_version: { increment: 1 } },
      });

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenLastCalledWith({
        where: {
          id: proposalId,
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
        },
        data: {
          status: AgentProposalStatus.FAILED,
          reason: 'Workshop task line items changed; please reload and retry',
        },
      });
    });

    it('uses targetTask.line_items_version when expected_line_items_version is omitted', async () => {
      const proposal = createMockProposal({
        action_type: 'workshop_order.add_line',
        payload_json: {
          order_id: 'wo-1',
          task_id: 'task-1',
          unit_price: 50,
          quantity: 1,
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
      mockPrisma.workshopOrder.findFirst.mockResolvedValueOnce({
        id: 'wo-1',
        status: WorkshopOrderStatus.IN_PROGRESS,
        purpose: null,
        tasks: [{ id: 'task-1', line_items_version: 4 }],
      });

      await service.approveProposal(proposalId);

      expect(mockPrisma.workshopTask.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'task-1',
          tenant_id: tenantId,
          workshop_order: { site_id: 'site-1' },
          line_items_version: 4,
        },
        data: { line_items_version: { increment: 1 } },
      });
    });
  });
});
