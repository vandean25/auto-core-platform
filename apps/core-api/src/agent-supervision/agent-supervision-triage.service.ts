import { BadRequestException, Injectable } from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { LoanerVehiclesService } from '../loaner-vehicles/loaner-vehicles.service.js';
import { WorkshopEstimateDecisionTriageService } from '../workshop/workshop-estimate-decision-triage.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { AgentProposalReadService } from '../agent-proposal/agent-proposal-read.service.js';
import { assertSupervisorAccess } from '../agent-proposal/agent-proposal.authorization.js';
import {
  InvalidSupervisionTriageCursorError,
  paginateSupervisionTriageCandidates,
  sortSupervisionTriageCandidates,
  type SupervisionTriageCandidate,
} from './agent-supervision-triage-order.js';
import type {
  AgentSupervisionTriageItemDto,
  AgentSupervisionTriageListResponseDto,
  QueryAgentSupervisionTriageDto,
} from './dto/agent-supervision-triage.dto.js';

@Injectable()
export class AgentSupervisionTriageService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly proposalReads: AgentProposalReadService,
    private readonly loanerVehicles: LoanerVehiclesService,
    private readonly estimateDecisions: WorkshopEstimateDecisionTriageService,
  ) {}

  async listTriage(
    query: QueryAgentSupervisionTriageDto,
  ): Promise<AgentSupervisionTriageListResponseDto> {
    assertSupervisorAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteIds = await this.siteContext.listAuthorizedSiteIds();
    if (siteIds.length === 0) {
      return { data: [], next_cursor: null };
    }

    const limit = query.limit ?? 20;
    const merged = await this.loadAuthorizedTriageCandidates(tenantId, siteIds);
    const sorted = sortSupervisionTriageCandidates(merged);

    let page: SupervisionTriageCandidate[];
    let next_cursor: string | null;
    try {
      const paginated = paginateSupervisionTriageCandidates(
        sorted,
        limit,
        query.cursor,
      );
      page = paginated.page;
      next_cursor = paginated.next_cursor;
    } catch (error) {
      if (error instanceof InvalidSupervisionTriageCursorError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    return {
      data: page.map(toTriageItemDto),
      next_cursor,
    };
  }

  private async loadAuthorizedTriageCandidates(
    tenantId: string,
    siteIds: string[],
  ): Promise<SupervisionTriageCandidate[]> {
    const [overdue, customerDecisions, customerWaiting, pendingApproval] =
      await Promise.all([
        this.loanerVehicles.listOverdueTriageCandidates(tenantId, siteIds),
        this.estimateDecisions.listCustomerDecisionTriageCandidates(
          tenantId,
          siteIds,
        ),
        this.proposalReads.listCustomerWaitingTriageCandidates(tenantId, siteIds),
        this.proposalReads.listPendingApprovalTriageCandidates(
          tenantId,
          siteIds,
        ),
      ]);

    return [...overdue, ...customerDecisions, ...customerWaiting, ...pendingApproval];
  }
}

function toTriageItemDto(
  item: SupervisionTriageCandidate,
): AgentSupervisionTriageItemDto {
  return {
    kind: item.kind,
    entity_id: item.entity_id,
    site_id: item.site_id,
    reason: item.reason,
    created_at: item.created_at.toISOString(),
    due_at: item.due_at ? item.due_at.toISOString() : null,
    record_link: item.record_link,
    allowed_action: item.allowed_action,
  };
}
