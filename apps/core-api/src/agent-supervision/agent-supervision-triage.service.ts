import { Injectable, Logger } from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { LoanerVehiclesService } from '../loaner-vehicles/loaner-vehicles.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { AgentProposalReadService } from '../agent-proposal/agent-proposal-read.service.js';
import { assertSupervisorAccess } from '../agent-proposal/agent-proposal.authorization.js';
import {
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
  private readonly logger = new Logger(AgentSupervisionTriageService.name);

  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly proposalReads: AgentProposalReadService,
    private readonly loanerVehicles: LoanerVehiclesService,
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
    const { page, next_cursor } = paginateSupervisionTriageCandidates(
      sorted,
      limit,
      query.cursor,
    );

    return {
      data: page.map(toTriageItemDto),
      next_cursor,
    };
  }

  private async loadAuthorizedTriageCandidates(
    tenantId: string,
    siteIds: string[],
  ): Promise<SupervisionTriageCandidate[]> {
    const [overdue, customerWaiting, pendingApproval] = await Promise.all([
      this.safeSource('OVERDUE_LOANER', () =>
        this.loanerVehicles.listOverdueTriageCandidates(tenantId, siteIds),
      ),
      this.safeSource('CUSTOMER_WAITING', () =>
        this.proposalReads.listCustomerWaitingTriageCandidates(
          tenantId,
          siteIds,
        ),
      ),
      this.safeSource('PENDING_APPROVAL', () =>
        this.proposalReads.listPendingApprovalTriageCandidates(
          tenantId,
          siteIds,
        ),
      ),
    ]);

    return [...overdue, ...customerWaiting, ...pendingApproval];
  }

  private async safeSource(
    label: string,
    loader: () => Promise<SupervisionTriageCandidate[]>,
  ): Promise<SupervisionTriageCandidate[]> {
    try {
      return await loader();
    } catch (error) {
      this.logger.warn(
        `Supervision triage source ${label} failed; returning no items from this source.`,
        error instanceof Error ? error.stack : String(error),
      );
      return [];
    }
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
