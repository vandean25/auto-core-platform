import { NotFoundException } from '@nestjs/common';
import { AgentProposalStatus, CustomerType } from '@prisma/client';
import { AgentProposalService } from './agent-proposal.service.js';
import { createAgentProposalSpecHarness, createMockProposal, proposalId, tenantId } from './agent-proposal.spec.support.js';

describe('AgentProposalService reads', () => {
  let service: AgentProposalService;
  let mockPrisma: any;
  let mockSiteContext: any;

  beforeEach(() => {
    ({ service, mockPrisma, mockSiteContext } = createAgentProposalSpecHarness());
  });

  describe('listProposals', () => {
    it('returns the originating agent for a pending MCP proposal', async () => {
      mockPrisma.agentProposal.findMany.mockResolvedValue([
        createMockProposal({ created_by_agent: 'agent-fixture-1' }),
      ]);

      const result = await service.listProposals({});
      const response = result.data[0] as unknown as Record<string, unknown>;

      expect(response.created_by_agent).toBe('agent-fixture-1');
    });

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

    it('returns effective target and amount for executor payload forms', async () => {
      mockPrisma.agentProposal.findMany.mockResolvedValue([
        createMockProposal({
          action_type: 'customer.update',
          payload_json: { customer_id: 'customer-123', amount_eur: 125 },
        }),
        createMockProposal({
          id: 'line-proposal',
          payload_json: {
            order_id: 'order-456',
            unit_price: 25,
            quantity: 4,
          },
        }),
      ]);

      const result = await service.listProposals({});

      expect(
        result.data.map(({ effective_summary }) => effective_summary),
      ).toEqual([
        {
          target_type: 'Customer',
          target_id: 'customer-123',
          amount_eur: 125,
        },
        {
          target_type: 'WorkshopOrder',
          target_id: 'order-456',
          amount_eur: 100,
        },
      ]);
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

  describe('workshop order context on proposal reads', () => {
    const orderId = '6fd17060-0000-4000-8000-000000000001';
    const demoOrder = {
      id: orderId,
      order_number: 'WO-2026-0001',
      customer: {
        type: CustomerType.PRIVATE,
        company_name: null,
        first_name: 'Maria',
        last_name: 'Demo',
      },
      vehicle: {
        plate: 'W-DEMO 101',
        year: 2019,
        make: 'Volkswagen',
        model: 'Golf',
      },
    };
    const orderLineProposal = (overrides?: Partial<any>) =>
      createMockProposal({
        action_type: 'workshop_order.propose_line',
        payload_json: {
          agent_id: 'workshop-agent',
          workshop_order_id: orderId,
          workshop_task_id: '44444444-4444-4444-4444-444444444444',
          expected_line_items_version: 0,
          line_item: {
            type: 'PART',
            item_no: 'DEMO-PART-001',
            description: 'Brake pad set',
            quantity: 1,
            unit_price_cents: 25000,
          },
        },
        ...overrides,
      });
    const summaryOf = (response: unknown) =>
      (response as Record<string, unknown>).workshop_order_summary;

    it('attaches order number, customer and vehicle to workshop order proposals', async () => {
      mockPrisma.agentProposal.findMany.mockResolvedValue([orderLineProposal()]);
      mockPrisma.workshopOrder.findMany.mockResolvedValue([demoOrder]);

      const result = await service.listProposals({});

      expect(summaryOf(result.data[0])).toEqual({
        id: orderId,
        order_number: 'WO-2026-0001',
        customer_name: 'Maria Demo',
        vehicle_registration: 'W-DEMO 101',
        vehicle_description: '2019 Volkswagen Golf',
      });
    });

    it('looks up a page of orders in one query scoped to tenant and authorized sites', async () => {
      mockSiteContext.listAuthorizedSiteIds.mockResolvedValue(['site-1', 'site-2']);
      mockPrisma.agentProposal.findMany.mockResolvedValue([
        orderLineProposal(),
        orderLineProposal({
          id: 'second-proposal',
          payload_json: { order_id: 'order-2', unit_price: 5, quantity: 2 },
        }),
      ]);
      mockPrisma.workshopOrder.findMany.mockResolvedValue([demoOrder]);

      await service.listProposals({});

      expect(mockPrisma.workshopOrder.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.workshopOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenant_id: tenantId,
            site_id: { in: ['site-1', 'site-2'] },
            id: { in: [orderId, 'order-2'] },
          },
        }),
      );
    });

    it('uses the company name for company customers', async () => {
      mockPrisma.agentProposal.findMany.mockResolvedValue([orderLineProposal()]);
      mockPrisma.workshopOrder.findMany.mockResolvedValue([
        {
          ...demoOrder,
          customer: {
            type: CustomerType.COMPANY,
            company_name: 'Demo Fleet GmbH',
            first_name: 'Max',
            last_name: 'Muster',
          },
        },
      ]);

      const result = await service.listProposals({});

      expect(summaryOf(result.data[0])).toEqual(
        expect.objectContaining({ customer_name: 'Demo Fleet GmbH' }),
      );
    });

    it('returns null for fields the order does not have instead of guessing them', async () => {
      mockPrisma.agentProposal.findMany.mockResolvedValue([orderLineProposal()]);
      mockPrisma.workshopOrder.findMany.mockResolvedValue([
        {
          ...demoOrder,
          order_number: '',
          customer: null,
          vehicle: { ...demoOrder.vehicle, plate: null },
        },
      ]);

      const result = await service.listProposals({});

      expect(summaryOf(result.data[0])).toEqual({
        id: orderId,
        order_number: null,
        customer_name: null,
        vehicle_registration: null,
        vehicle_description: '2019 Volkswagen Golf',
      });
    });

    it('returns no summary when the order is not visible in the caller sites', async () => {
      mockPrisma.agentProposal.findMany.mockResolvedValue([orderLineProposal()]);
      mockPrisma.workshopOrder.findMany.mockResolvedValue([]);

      const result = await service.listProposals({});

      expect(summaryOf(result.data[0])).toBeNull();
    });

    it('skips the order lookup for proposals that do not reference a workshop order', async () => {
      mockPrisma.agentProposal.findMany.mockResolvedValue([
        createMockProposal({
          action_type: 'customer.update',
          payload_json: { customer_id: 'customer-123', amount_eur: 125 },
        }),
      ]);

      const result = await service.listProposals({});

      expect(mockPrisma.workshopOrder.findMany).not.toHaveBeenCalled();
      expect(summaryOf(result.data[0])).toBeNull();
    });

    it('includes the order summary on detail reads', async () => {
      mockPrisma.agentProposal.findFirst.mockResolvedValue(orderLineProposal());
      mockPrisma.workshopOrder.findMany.mockResolvedValue([demoOrder]);

      const result = await service.getProposalById(proposalId);

      expect(summaryOf(result)).toEqual(
        expect.objectContaining({ order_number: 'WO-2026-0001' }),
      );
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
});
