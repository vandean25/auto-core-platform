import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AgentProposalStatus,
  WorkshopTaskStatus,
  WorkshopEstimateStatus,
  type AgentProposal,
} from '@prisma/client';
import { loadTenantUserContacts } from '../common/services/tenant-user-contact.util.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { assertSupervisorAccess } from './agent-proposal.authorization.js';
import { expirePendingProposal } from './agent-proposal-decision-lifecycle.js';
import {
  readExecutionSiteId,
  resolveWorkshopOrderId,
} from './agent-proposal-payload.js';
import {
  buildCustomerWaitingTriageCandidates,
  type CustomerWaitingTriageRecord,
} from '../workshop/workshop-order-communications.js';
import type { SupervisionTriageCandidate } from '../agent-supervision/agent-supervision-triage-order.js';
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
        ...(query.ids?.length ? { id: { in: [...query.ids] } } : {}),
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: query.ids?.length
        ? Math.min(query.ids.length, query.limit ?? query.ids.length)
        : (query.limit ?? 50),
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
      await expirePendingProposal(this.prisma, proposal, tenantId);
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

  /**
   * Pending agent proposals the supervisor may act on, scoped to authorized sites.
   */
  async listPendingApprovalTriageCandidates(
    tenantId: string,
    siteIds: readonly string[],
  ): Promise<SupervisionTriageCandidate[]> {
    if (siteIds.length === 0) {
      return [];
    }

    const now = new Date();
    await this.prisma.agentProposal.updateMany({
      where: {
        tenant_id: tenantId,
        status: AgentProposalStatus.PENDING,
        expires_at: { lt: now },
      },
      data: { status: AgentProposalStatus.EXPIRED },
    });

    const proposals = await this.prisma.agentProposal.findMany({
      where: {
        tenant_id: tenantId,
        status: AgentProposalStatus.PENDING,
        expires_at: { gte: now },
      },
      select: {
        id: true,
        action_type: true,
        payload_json: true,
        preview_json: true,
        createdAt: true,
        expires_at: true,
      },
    });

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

    const orderSiteById = new Map<string, string>();
    if (orderIds.length > 0) {
      const orders = await this.prisma.workshopOrder.findMany({
        where: {
          tenant_id: tenantId,
          site_id: { in: [...siteIds] },
          id: { in: orderIds },
        },
        select: { id: true, site_id: true },
      });
      for (const order of orders) {
        if (order.site_id) {
          orderSiteById.set(order.id, order.site_id);
        }
      }
    }

    const authorizedSites = new Set(siteIds);
    const items: SupervisionTriageCandidate[] = [];

    for (const proposal of proposals) {
      const payload = (proposal.payload_json ?? {}) as Record<string, unknown>;
      const orderId = resolveWorkshopOrderId(proposal.action_type, payload);
      const siteId = orderId
        ? orderSiteById.get(orderId)
        : readExecutionSiteId(proposal.preview_json);
      if (!siteId || !authorizedSites.has(siteId)) {
        continue;
      }
      items.push({
        kind: 'PENDING_APPROVAL',
        entity_id: proposal.id,
        site_id: siteId,
        reason: 'AGENT_PROPOSAL_PENDING',
        created_at: proposal.createdAt,
        due_at: proposal.expires_at,
        record_link: '/agent/supervision',
        allowed_action: 'APPROVE_REJECT',
      });
    }

    return items;
  }

  /**
   * Workshop tasks waiting on the customer and sent estimates awaiting a KVA answer.
   */
  async listCustomerWaitingTriageCandidates(
    tenantId: string,
    siteIds: readonly string[],
  ): Promise<SupervisionTriageCandidate[]> {
    if (siteIds.length === 0) {
      return [];
    }

    const [waitingTasks, sentEstimates] = await Promise.all([
      this.prisma.workshopTask.findMany({
        where: {
          tenant_id: tenantId,
          status: WorkshopTaskStatus.WAITING_CUSTOMER,
          workshop_order: { site_id: { in: [...siteIds] } },
        },
        select: {
          id: true,
          createdAt: true,
          workshop_order_id: true,
          workshop_order: { select: { site_id: true } },
        },
      }),
      this.prisma.workshopEstimateVersion.findMany({
        where: {
          tenant_id: tenantId,
          status: WorkshopEstimateStatus.SENT,
          estimate: {
            workshop_order: { site_id: { in: [...siteIds] } },
          },
        },
        select: {
          id: true,
          sent_at: true,
          createdAt: true,
          estimate: {
            select: {
              workshop_order_id: true,
              workshop_order: { select: { site_id: true } },
            },
          },
        },
      }),
    ]);

    const records: CustomerWaitingTriageRecord[] = [
      ...waitingTasks.flatMap((task) => {
        const siteId = task.workshop_order.site_id;
        if (!siteId) {
          return [];
        }
        return [
          {
            entity_id: task.id,
            site_id: siteId,
            workshop_order_id: task.workshop_order_id,
            source: 'WORKSHOP_TASK_WAITING_CUSTOMER' as const,
            created_at: task.createdAt,
            due_at: null,
          },
        ];
      }),
      ...sentEstimates.flatMap((version) => {
        const siteId = version.estimate.workshop_order.site_id;
        if (!siteId) {
          return [];
        }
        return [
          {
            entity_id: version.id,
            site_id: siteId,
            workshop_order_id: version.estimate.workshop_order_id,
            source: 'ESTIMATE_AWAITING_CUSTOMER_RESPONSE' as const,
            created_at: version.sent_at ?? version.createdAt,
            due_at: null,
          },
        ];
      }),
    ];

    return buildCustomerWaitingTriageCandidates(records);
  }
}
