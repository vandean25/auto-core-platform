import { Injectable, NotFoundException } from '@nestjs/common';
import { AgentProposalStatus } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MECHANIC_FINDING_ACTION_TYPE } from '../mechanic/mechanic-finding.constants.js';
import type {
  WorkshopMechanicFindingDto,
  WorkshopMechanicFindingListResponseDto,
} from './dto/workshop-mechanic-finding.dto.js';
import { assertEstimateRole } from './workshop-estimate-scope.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

@Injectable()
export class WorkshopMechanicFindingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  async listForOrder(
    orderId: string,
  ): Promise<WorkshopMechanicFindingListResponseDto> {
    assertEstimateRole(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();

    const order = await this.prisma.workshopOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId, site_id: siteId },
      select: { id: true },
    });
    if (!order) {
      throw new NotFoundException('Workshop order not found');
    }

    const proposals = await this.prisma.agentProposal.findMany({
      where: {
        tenant_id: tenantId,
        action_type: MECHANIC_FINDING_ACTION_TYPE,
        payload_json: {
          path: ['workshop_order_id'],
          equals: orderId,
        },
        status: {
          in: [
            AgentProposalStatus.PENDING,
            AgentProposalStatus.APPROVED,
            AgentProposalStatus.EXECUTED,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const data: WorkshopMechanicFindingDto[] = [];
    for (const proposal of proposals) {
      const dto = this.toFindingDto(proposal);
      if (dto) {
        data.push(dto);
      }
    }

    return { data };
  }

  private toFindingDto(proposal: {
    id: string;
    trace_id: string;
    status: AgentProposalStatus;
    payload_json: unknown;
    createdAt: Date;
  }): WorkshopMechanicFindingDto | null {
    const payload = asRecord(proposal.payload_json);
    const finding = asRecord(payload.finding);
    const taskId =
      typeof payload.workshop_task_id === 'string'
        ? payload.workshop_task_id
        : '';
    const text = typeof finding.text === 'string' ? finding.text : '';
    const mediaRaw = Array.isArray(finding.media) ? finding.media : [];
    const media = mediaRaw
      .map((entry) => asRecord(entry))
      .filter((entry) => typeof entry.id === 'string')
      .map((entry) => ({
        id: entry.id as string,
        mime_type:
          typeof entry.mime_type === 'string'
            ? entry.mime_type
            : 'application/octet-stream',
        caption:
          typeof entry.caption === 'string'
            ? entry.caption
            : entry.caption === null
              ? null
              : null,
      }));

    if (!taskId || !text) {
      return null;
    }

    return {
      proposal_id: proposal.id,
      trace_id: proposal.trace_id,
      status: proposal.status,
      workshop_task_id: taskId,
      finding_text: text,
      media,
      summary: typeof finding.summary === 'string' ? finding.summary : null,
      created_at: proposal.createdAt.toISOString(),
    };
  }
}
