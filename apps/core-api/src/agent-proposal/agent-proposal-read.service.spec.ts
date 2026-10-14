import { ForbiddenException } from '@nestjs/common';
import { AgentProposalStatus } from '@prisma/client';
import {
  createAgentProposalSpecHarness,
  createMockProposal,
  tenantId,
  userId,
} from './agent-proposal.spec.support.js';

describe('AgentProposalReadService', () => {
  let h: ReturnType<typeof createAgentProposalSpecHarness>;

  beforeEach(() => {
    h = createAgentProposalSpecHarness();
  });

  it('resolves the decider name and email in one tenant-scoped lookup', async () => {
    h.mockPrisma.user.findMany.mockResolvedValue([
      {
        id: userId,
        email: 'sam@example.com',
        firstName: 'Sam',
        lastName: 'Supervisor',
      },
    ]);
    const decided = createMockProposal({
      status: AgentProposalStatus.APPROVED,
      decided_by: userId,
      decided_at: new Date('2026-01-02T00:00:00.000Z'),
    });

    const result = await h.reads.toResponseWithDecider(tenantId, decided);

    expect(result.decided_by_name).toBe('Sam Supervisor');
    expect(result.decided_by_email).toBe('sam@example.com');
    expect(result.decided_at).toBe('2026-01-02T00:00:00.000Z');
    expect(h.mockPrisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(h.mockPrisma.user.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: [userId] },
        memberships: { some: { tenant_id: tenantId } },
      },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
  });

  it('does not look up a decider for a proposal nobody has decided', async () => {
    const result = await h.reads.toResponseWithDecider(
      tenantId,
      createMockProposal(),
    );

    expect(result.decided_by_name).toBeNull();
    expect(result.decided_by_email).toBeNull();
    expect(h.mockPrisma.user.findMany).not.toHaveBeenCalled();
  });

  it('refuses to list proposals for roles without supervision access', async () => {
    h.mockTenantContext.getAuthenticatedUser.mockReturnValue({
      userId: 'fb-user-2',
      tenantId,
      role: 'TECH',
    });

    await expect(h.reads.listProposals({})).rejects.toThrow(
      ForbiddenException,
    );
    expect(h.mockPrisma.agentProposal.updateMany).not.toHaveBeenCalled();
  });

  it('expires overdue pending proposals before listing, tenant-scoped', async () => {
    h.mockPrisma.agentProposal.findMany.mockResolvedValue([]);

    await h.reads.listProposals({ limit: 10 });

    expect(h.mockPrisma.agentProposal.updateMany).toHaveBeenCalledWith({
      where: {
        tenant_id: tenantId,
        status: AgentProposalStatus.PENDING,
        expires_at: { lt: expect.any(Date) },
      },
      data: { status: AgentProposalStatus.EXPIRED },
    });
    expect(h.mockPrisma.agentProposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenant_id: tenantId }, take: 10 }),
    );
  });

  it('loads each referenced workshop order once for a list', async () => {
    h.mockPrisma.agentProposal.findMany.mockResolvedValue([
      createMockProposal({ id: 'p-1', payload_json: { order_id: 'wo-1' } }),
      createMockProposal({ id: 'p-2', payload_json: { order_id: 'wo-1' } }),
    ]);

    await h.reads.listProposals({});

    expect(h.mockPrisma.workshopOrder.findMany).toHaveBeenCalledTimes(1);
    expect(h.mockPrisma.workshopOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenant_id: tenantId,
          site_id: { in: ['site-1'] },
          id: { in: ['wo-1'] },
        },
      }),
    );
  });

  it('skips the order lookup and returns no order context without authorized sites', async () => {
    h.mockSiteContext.listAuthorizedSiteIds.mockResolvedValue([]);
    h.mockPrisma.agentProposal.findMany.mockResolvedValue([
      createMockProposal({ payload_json: { order_id: 'wo-1' } }),
    ]);

    const result = await h.reads.listProposals({});

    expect(h.mockPrisma.workshopOrder.findMany).not.toHaveBeenCalled();
    expect(result.data[0].workshop_order_summary).toBeNull();
  });
});
