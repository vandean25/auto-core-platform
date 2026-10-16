import { Injectable, NotFoundException } from '@nestjs/common';
import { AgentProposalStatus } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MechanicMediaStorage } from '../mechanic/mechanic-media.storage.js';
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
    private readonly mediaStorage: MechanicMediaStorage,
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

    const mediaIds = new Set<string>();
    const parsed = proposals
      .map((proposal) => {
        const dto = this.parseFindingPayload(proposal);
        if (dto) {
          for (const item of dto.media) {
            mediaIds.add(item.id);
          }
        }
        return dto ? { proposal, dto } : null;
      })
      .filter(
        (
          entry,
        ): entry is {
          proposal: (typeof proposals)[number];
          dto: Omit<WorkshopMechanicFindingDto, 'media'> & {
            media: Array<{
              id: string;
              mime_type: string;
              caption: string | null;
            }>;
          };
        } => entry !== null,
      );

    const readUrlByMediaId = await this.loadReadUrls(tenantId, [...mediaIds]);

    const data: WorkshopMechanicFindingDto[] = parsed.map(({ proposal, dto }) => ({
      proposal_id: proposal.id,
      trace_id: proposal.trace_id,
      status: proposal.status,
      workshop_task_id: dto.workshop_task_id,
      finding_text: dto.finding_text,
      summary: dto.summary,
      created_at: proposal.createdAt.toISOString(),
      media: dto.media.map((item) => ({
        ...item,
        read_url: readUrlByMediaId.get(item.id) ?? '',
      })),
    }));

    return { data };
  }

  private parseFindingPayload(proposal: {
    payload_json: unknown;
  }): {
    workshop_task_id: string;
    finding_text: string;
    summary: string | null;
    media: Array<{ id: string; mime_type: string; caption: string | null }>;
  } | null {
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
      workshop_task_id: taskId,
      finding_text: text,
      media,
      summary: typeof finding.summary === 'string' ? finding.summary : null,
    };
  }

  private async loadReadUrls(
    tenantId: string,
    mediaIds: string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (mediaIds.length === 0) {
      return result;
    }

    const rows = await this.prisma.workshopMedia.findMany({
      where: { tenant_id: tenantId, id: { in: mediaIds } },
      select: {
        id: true,
        storage_bucket: true,
        storage_key: true,
        mime_type: true,
      },
    });

    await Promise.all(
      rows.map(async (row) => {
        try {
          const url = await this.mediaStorage.generateSignedReadUrl(
            row.storage_bucket,
            row.storage_key,
            row.mime_type,
          );
          result.set(row.id, url);
        } catch {
          result.set(row.id, '');
        }
      }),
    );

    return result;
  }
}
