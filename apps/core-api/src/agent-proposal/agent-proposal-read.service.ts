import { Injectable, NotFoundException } from '@nestjs/common';
import { AgentProposalStatus, type AgentProposal } from '@prisma/client';
import { loadTenantUserContacts } from '../common/services/tenant-user-contact.util.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { assertSupervisorAccess } from './agent-proposal.authorization.js';
import { resolveWorkshopOrderId } from './agent-proposal-payload.js';
import { toAgentProposalResponseDto } from './agent-proposal-response.mapper.js';
import { toWorkshopOrderSummary } from './agent-proposal-order-summary.js';
import type {
  AgentProposalListResponseDto,
  AgentProposalResponseDto,
  AgentProposalWorkshopOrderSummaryDto,
  QueryAgentProposalsDto,
} from './dto/agent-proposal.dto.js';

/** Read paths for proposals: list and detail, with lazy expiry and display context. */
@Injectable()
export class AgentProposalReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  async listProposals(
    query: QueryAgentProposalsDto,
  ): Promise<AgentProposalListResponseDto> {
    assertSupervisorAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();

    const now = new Date();
    await this.prisma.agentProposal.updateMany({
      where: {
        tenant_id: tenantId,
        status: AgentProposalStatus.PENDING,
        expires_at: { lt: now },
      },
      data: {
        status: AgentProposalStatus.EXPIRED,
      },
    });

    const proposals = await this.prisma.agentProposal.findMany({
      where: {
        tenant_id: tenantId,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: query.limit ?? 50,
    });

    const workshopOrderSummaries = await this.loadWorkshopOrderSummaries(
      tenantId,
      proposals,
    );
    const deciders = await loadTenantUserContacts(
      this.prisma,
      tenantId,
      proposals.map((proposal) => proposal.decided_by),
    );
    return {
      data: proposals.map((proposal) =>
        toAgentProposalResponseDto(proposal, workshopOrderSummaries, deciders),
      ),
    };
  }

  async getProposalById(id: string): Promise<AgentProposalResponseDto> {
    assertSupervisorAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();

    const proposal = await this.prisma.agentProposal.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!proposal) {
      throw new NotFoundException('Proposal not found');
    }

    if (
      proposal.status === AgentProposalStatus.PENDING &&
      proposal.expires_at < new Date()
    ) {
      await this.prisma.agentProposal.updateMany({
        where: {
          id: proposal.id,
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
        },
        data: { status: AgentProposalStatus.EXPIRED },
      });
      proposal.status = AgentProposalStatus.EXPIRED;
    }

    const workshopOrderSummaries = await this.loadWorkshopOrderSummaries(
      tenantId,
      [proposal],
    );
    return this.toResponseWithDecider(
      tenantId,
      proposal,
      workshopOrderSummaries,
    );
  }

  /**
   * Single-proposal response that also resolves the decider's name and email.
   * Lists batch that lookup in one query instead of calling this per row.
   */
  async toResponseWithDecider(
    tenantId: string,
    proposal: AgentProposal,
    workshopOrderSummaries: Map<
      string,
      AgentProposalWorkshopOrderSummaryDto
    > = new Map(),
  ): Promise<AgentProposalResponseDto> {
    const deciders = await loadTenantUserContacts(this.prisma, tenantId, [
      proposal.decided_by,
    ]);
    return toAgentProposalResponseDto(
      proposal,
      workshopOrderSummaries,
      deciders,
    );
  }

  /**
   * Read-only display context for workshop order proposals. Orders are
   * site-owned, so only orders in sites the caller may operate on are loaded.
   * Anything else resolves to null and the card shows plain fallbacks.
   */
  private async loadWorkshopOrderSummaries(
    tenantId: string,
    proposals: AgentProposal[],
  ): Promise<Map<string, AgentProposalWorkshopOrderSummaryDto>> {
    const summaries = new Map<string, AgentProposalWorkshopOrderSummaryDto>();
    const orderIds = [
      ...new Set(
        proposals
          .map((proposal) =>
            resolveWorkshopOrderId(
              proposal.action_type,
              (proposal.payload_json ?? {}) as Record<string, unknown>,
            ),
          )
          .filter((orderId): orderId is string => orderId !== null),
      ),
    ];
    if (orderIds.length === 0) {
      return summaries;
    }

    const siteIds = await this.siteContext.listAuthorizedSiteIds();
    if (siteIds.length === 0) {
      return summaries;
    }

    const orders = await this.prisma.workshopOrder.findMany({
      where: {
        tenant_id: tenantId,
        site_id: { in: siteIds },
        id: { in: orderIds },
      },
      select: {
        id: true,
        order_number: true,
        customer: {
          select: {
            type: true,
            company_name: true,
            first_name: true,
            last_name: true,
          },
        },
        vehicle: {
          select: { plate: true, year: true, make: true, model: true },
        },
      },
    });

    for (const order of orders) {
      summaries.set(order.id, toWorkshopOrderSummary(order));
    }
    return summaries;
  }
}
