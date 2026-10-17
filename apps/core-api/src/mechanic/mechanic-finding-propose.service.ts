import { createHash } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertOrderEditable } from '../workshop/workshop-order.helpers.js';
import { mechanicFindingMediaPurposeFilter } from '../workshop/workshop-media-purpose.helpers.js';
import { MECHANIC_FINDING_ACTION_TYPE } from './mechanic-finding.constants.js';
import {
  proposeMechanicFindingInputSchema,
  type ProposeMechanicFindingInput,
} from './mechanic-finding-propose.schema.js';
import {
  coerceMechanicFindingApplyInput,
  extractMechanicFindingMcpInput,
  readMechanicFindingSubmitAgentId,
} from './mechanic-finding-payload.util.js';

export const MECHANIC_FINDING_MCP_PROPOSE_ACTION_TYPE =
  'workshop_order.propose_mechanic_finding';

export type MechanicFindingProposePreview = {
  workshop_order_id: string;
  workshop_task_id: string;
  site_id: string;
  description: string;
  media_count: number;
  proposed_line_item_count: number;
  finding_evidence: {
    text: string;
    media_count: number;
    task_id: string;
    order_id: string;
  };
};

export type MechanicFindingProposeApplyResult = {
  id: string;
  entityId: string;
  workshop_order_id: string;
  workshop_task_id: string;
};

@Injectable()
export class MechanicFindingProposeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  async buildExecutionContext(): Promise<Record<string, unknown>> {
    const siteId = await this.siteContext.getSiteId();
    const tenantId = await this.tenantContext.getTenantId();
    const site = await this.prisma.site.findFirst({
      where: { id: siteId, tenant_id: tenantId, is_active: true },
      select: { id: true },
    });
    if (!site) {
      throw new NotFoundException('Active site not found');
    }
    return { site_id: siteId };
  }

  async enrichInput(input: unknown): Promise<unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return input;
    }
    const record = { ...(input as Record<string, unknown>) };
    const parsed = proposeMechanicFindingInputSchema.parse(record);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const plan = await this.planFinding(parsed, tenantId, siteId);
    record.pinned_media_ids = plan.mediaIds;
    record.pinned_line_items_version = plan.lineItemsVersion;
    record.pinned_proposed_line_items = plan.proposedLineItems;
    return record;
  }

  /** Supervisor submit: validate media and store the same payload shape as MCP propose. */
  async normalizeSubmitPayload(
    payload: unknown,
  ): Promise<Record<string, unknown>> {
    const mcpInput = extractMechanicFindingMcpInput(payload);
    const agentId = readMechanicFindingSubmitAgentId(payload);
    const built = await this.buildProposalPayload(mcpInput, agentId);
    return built.payload_json;
  }

  async buildProposalPayload(
    input: unknown,
    agentId: string,
  ): Promise<{
    action_type: string;
    payload_json: Record<string, unknown>;
    preview_json: Record<string, unknown>;
  }> {
    const parsed = proposeMechanicFindingInputSchema.parse(input);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const plan = await this.planFinding(parsed, tenantId, siteId);
    const description = parsed.description.trim();
    const payload = {
      workshop_order_id: parsed.workshop_order_id,
      workshop_task_id: parsed.workshop_task_id,
      site_id: siteId,
      command_id: parsed.command_id ?? null,
      agent_id: agentId,
      finding: {
        text: description,
        text_sha256: createHash('sha256')
          .update(description, 'utf8')
          .digest('hex'),
        summary: null,
        media: plan.mediaRefs,
        voice_note_draft_id: null,
        proposed_line_items: plan.proposedLineItems,
        line_items_version: plan.lineItemsVersion,
      },
    };
    const preview = {
      finding_evidence: {
        text: description,
        media_count: plan.mediaRefs.length,
        task_id: parsed.workshop_task_id,
        order_id: parsed.workshop_order_id,
      },
      proposed_line_items: plan.proposedLineItems,
      would_change: [],
      provisional: true,
      execution_context: { site_id: siteId },
    };
    return {
      action_type: MECHANIC_FINDING_ACTION_TYPE,
      payload_json: payload,
      preview_json: preview,
    };
  }

  async applyAcknowledgment(
    input: unknown,
    executionContext?: Record<string, unknown>,
  ): Promise<MechanicFindingProposeApplyResult> {
    const parsed = coerceMechanicFindingApplyInput(input);
    const tenantId = await this.tenantContext.getTenantId();
    const expectedSiteId =
      typeof executionContext?.site_id === 'string'
        ? executionContext.site_id
        : await this.siteContext.getSiteId();

    if (parsed.pinned_media_ids) {
      const unique = new Set(parsed.pinned_media_ids);
      if (unique.size !== parsed.pinned_media_ids.length) {
        throw new ConflictException('Duplicate media id in pinned_media_ids');
      }
    }

    const plan = await this.planFinding(parsed, tenantId, expectedSiteId);
    this.assertPinnedState(parsed, plan);

    const order = await this.prisma.workshopOrder.findFirst({
      where: {
        id: parsed.workshop_order_id,
        tenant_id: tenantId,
        site_id: expectedSiteId,
      },
      select: { id: true, status: true, purpose: true },
    });
    if (!order) {
      throw new NotFoundException(
        `Workshop order ${parsed.workshop_order_id} not found`,
      );
    }
    assertOrderEditable(order);

    const task = await this.prisma.workshopTask.findFirst({
      where: {
        id: parsed.workshop_task_id,
        tenant_id: tenantId,
        workshop_order_id: parsed.workshop_order_id,
        workshop_order: { site_id: expectedSiteId },
      },
      select: { id: true },
    });
    if (!task) {
      throw new NotFoundException(
        `Workshop task ${parsed.workshop_task_id} not found`,
      );
    }

    return {
      id: task.id,
      entityId: task.id,
      workshop_order_id: order.id,
      workshop_task_id: task.id,
    };
  }

  async buildPreview(input: unknown): Promise<MechanicFindingProposePreview> {
    const parsed = proposeMechanicFindingInputSchema.parse(input);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const plan = await this.planFinding(parsed, tenantId, siteId);
    const description = parsed.description.trim();
    return {
      workshop_order_id: parsed.workshop_order_id,
      workshop_task_id: parsed.workshop_task_id,
      site_id: siteId,
      description,
      media_count: plan.mediaRefs.length,
      proposed_line_item_count: plan.proposedLineItems.length,
      finding_evidence: {
        text: description,
        media_count: plan.mediaRefs.length,
        task_id: parsed.workshop_task_id,
        order_id: parsed.workshop_order_id,
      },
    };
  }

  private assertPinnedState(
    parsed: ProposeMechanicFindingInput,
    plan: Awaited<ReturnType<MechanicFindingProposeService['planFinding']>>,
  ): void {
    if (parsed.pinned_media_ids) {
      const expected = [...parsed.pinned_media_ids].sort();
      const actual = [...plan.mediaIds].sort();
      if (expected.join(',') !== actual.join(',')) {
        throw new ConflictException(
          'Media ids do not match the pinned proposal state',
        );
      }
    }
    if (
      parsed.pinned_line_items_version !== undefined &&
      parsed.pinned_line_items_version !== plan.lineItemsVersion
    ) {
      throw new ConflictException(
        'Task line_items_version does not match the pinned proposal state',
      );
    }
    if (parsed.pinned_proposed_line_items) {
      const expected = JSON.stringify(parsed.pinned_proposed_line_items);
      const actual = JSON.stringify(plan.proposedLineItems);
      if (expected !== actual) {
        throw new ConflictException(
          'Proposed line items do not match the pinned proposal state',
        );
      }
    }
  }

  private async planFinding(
    parsed: ProposeMechanicFindingInput,
    tenantId: string,
    siteId: string,
  ) {
    const task = await this.prisma.workshopTask.findFirst({
      where: {
        id: parsed.workshop_task_id,
        tenant_id: tenantId,
        workshop_order_id: parsed.workshop_order_id,
        workshop_order: { site_id: siteId, tenant_id: tenantId },
      },
      select: {
        id: true,
        status: true,
        line_items_version: true,
        workshop_order: {
          select: { id: true, status: true, purpose: true, site_id: true },
        },
      },
    });
    if (!task) {
      throw new NotFoundException(
        `Workshop task ${parsed.workshop_task_id} not found for this order`,
      );
    }
    if (task.status === 'DONE') {
      throw new UnprocessableEntityException(
        `Cannot propose a finding for completed task ${parsed.workshop_task_id}.`,
      );
    }
    assertOrderEditable(task.workshop_order);

    const mediaIds = [...new Set(parsed.media_ids ?? [])];
    const mediaRefs = await this.resolveMediaRefs(
      tenantId,
      siteId,
      parsed.workshop_order_id,
      parsed.workshop_task_id,
      mediaIds,
    );

    const proposedLineItems = parsed.proposed_line_items ?? [];

    return {
      mediaIds,
      mediaRefs,
      lineItemsVersion: task.line_items_version,
      proposedLineItems,
    };
  }

  private async resolveMediaRefs(
    tenantId: string,
    siteId: string,
    orderId: string,
    taskId: string,
    requestedMediaIds: string[],
  ) {
    if (requestedMediaIds.length === 0) {
      return [];
    }

    const rows = await this.prisma.workshopMedia.findMany({
      where: {
        tenant_id: tenantId,
        id: { in: requestedMediaIds },
        workshop_order_id: orderId,
        workshop_task_id: taskId,
        purpose: mechanicFindingMediaPurposeFilter(),
        workshop_order: { site_id: siteId },
      },
      select: { id: true, mime_type: true, caption: true, storage_key: true },
    });

    if (rows.length !== requestedMediaIds.length) {
      throw new UnprocessableEntityException(
        'One or more media_ids are invalid for this workshop task',
      );
    }

    for (const row of rows) {
      if (!row.storage_key || row.storage_key.length === 0) {
        throw new UnprocessableEntityException(
          'One or more media items were not uploaded yet',
        );
      }
    }

    return rows.map((row) => ({
      id: row.id,
      mime_type: row.mime_type,
      caption: row.caption,
    }));
  }
}
