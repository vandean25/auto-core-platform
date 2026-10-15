import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AgentPolicyTier,
  AgentProposalStatus,
  WorkshopVoiceNoteDraftStatus,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { AgentProposalService } from '../agent-proposal/agent-proposal.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../common/services/site-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertOrderEditable } from '../workshop/workshop-order.helpers.js';
import { assertTaskAccessibleAndNotDone } from './mechanic-task-access.js';
import type { SubmitMechanicFindingDto } from './dto/submit-mechanic-finding.dto.js';
import type { SubmitMechanicFindingResponseDto } from './dto/submit-mechanic-finding.dto.js';
import { MECHANIC_FINDING_ACTION_TYPE } from './mechanic-finding.constants.js';
import { fingerprintMcpWriteArgs } from '../mcp/mcp-write-command-idempotency.util.js';

type FindingMediaRef = {
  id: string;
  mime_type: string;
  caption: string | null;
};

@Injectable()
export class MechanicFindingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly agentProposals: AgentProposalService,
  ) {}

  async submitFinding(
    mechanicId: string,
    taskId: string,
    dto: SubmitMechanicFindingDto,
  ): Promise<SubmitMechanicFindingResponseDto> {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();

    if (dto.command_id) {
      const replay = await this.findIdempotentProposal(tenantId, dto);
      if (replay) {
        return replay;
      }
    }

    const task = await this.prisma.workshopTask.findFirst({
      where: { id: taskId, tenant_id: tenantId },
      select: {
        id: true,
        status: true,
        bay_id: true,
        mechanic_id: true,
        mechanic_notes: true,
        workshop_order_id: true,
        workshop_order: {
          select: {
            id: true,
            site_id: true,
            status: true,
            purpose: true,
            mechanic_id: true,
            bay_id: true,
          },
        },
      },
    });

    assertTaskAccessibleAndNotDone(
      task,
      taskId,
      mechanicId,
      `Cannot submit findings for completed task ${taskId}.`,
    );

    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found`);
    }

    if (task.workshop_order.site_id !== siteId) {
      throw new NotFoundException(`Task ${taskId} not found`);
    }

    assertOrderEditable(task.workshop_order);

    const findingText = await this.resolveFindingText(
      tenantId,
      taskId,
      mechanicId,
      task.mechanic_notes,
      dto.voice_note_draft_id,
    );

    const mediaRefs = await this.resolveAuthorizedMedia(
      tenantId,
      siteId,
      mechanicId,
      taskId,
      task.workshop_order_id,
      dto.media_ids ?? [],
    );

    const traceId = dto.command_id ?? randomUUID();
    const payload = {
      workshop_order_id: task.workshop_order_id,
      workshop_task_id: taskId,
      site_id: siteId,
      command_id: dto.command_id ?? null,
      mechanic_employee_id: mechanicId,
      finding: {
        text: findingText,
        text_sha256: createHash('sha256').update(findingText, 'utf8').digest('hex'),
        summary: dto.summary ?? null,
        media: mediaRefs,
        voice_note_draft_id: dto.voice_note_draft_id ?? null,
      },
    };

    const preview = {
      finding_evidence: {
        text: findingText,
        media_count: mediaRefs.length,
        task_id: taskId,
        order_id: task.workshop_order_id,
      },
      would_change: [],
      provisional: true,
      execution_context: { site_id: siteId },
      ...(dto.command_id
        ? {
            mcp_command_idempotency: {
              command_id: dto.command_id,
              args_fingerprint: fingerprintMcpWriteArgs(
                MECHANIC_FINDING_ACTION_TYPE,
                payload,
              ),
            },
          }
        : {}),
    };

    const created = await this.agentProposals.persistPendingAction({
      action_type: MECHANIC_FINDING_ACTION_TYPE,
      payload_json: payload,
      preview_json: preview,
      tier: AgentPolicyTier.PROPOSE,
      trace_id: traceId,
      created_by_agent: 'mechanic_tablet',
    });

    return {
      proposalId: created.id,
      traceId: created.trace_id,
      actionType: MECHANIC_FINDING_ACTION_TYPE,
    };
  }

  private async findIdempotentProposal(
    tenantId: string,
    dto: SubmitMechanicFindingDto,
  ): Promise<SubmitMechanicFindingResponseDto | null> {
    const commandId = dto.command_id;
    if (!commandId) {
      return null;
    }

    const existing = await this.prisma.agentProposal.findFirst({
      where: {
        tenant_id: tenantId,
        trace_id: commandId,
        action_type: MECHANIC_FINDING_ACTION_TYPE,
      },
    });
    if (!existing) {
      return null;
    }

    const payload = existing.payload_json as Record<string, unknown> | null;
    const storedCommandId =
      payload && typeof payload.command_id === 'string'
        ? payload.command_id
        : null;
    if (storedCommandId && storedCommandId !== commandId) {
      throw new ConflictException(
        'This command_id was already used for a different mechanic finding',
      );
    }

    if (existing.status === AgentProposalStatus.FAILED) {
      throw new ConflictException(
        'A previous mechanic finding with this command_id failed',
      );
    }

    return {
      proposalId: existing.id,
      traceId: existing.trace_id,
      actionType: existing.action_type,
    };
  }

  private async resolveFindingText(
    tenantId: string,
    taskId: string,
    mechanicId: string,
    mechanicNotes: string | null,
    voiceNoteDraftId?: string,
  ): Promise<string> {
    if (voiceNoteDraftId) {
      const draft = await this.prisma.workshopVoiceNoteDraft.findFirst({
        where: {
          id: voiceNoteDraftId,
          tenant_id: tenantId,
          workshop_task_id: taskId,
          mechanic_employee_id: mechanicId,
        },
        select: { status: true, translated_text: true },
      });
      if (!draft) {
        throw new NotFoundException('Voice note draft not found for this task');
      }
      if (draft.status !== WorkshopVoiceNoteDraftStatus.ACCEPTED) {
        throw new UnprocessableEntityException(
          'Voice note draft must be accepted before submitting a finding',
        );
      }
      const accepted = draft.translated_text?.trim() ?? '';
      if (!accepted) {
        throw new UnprocessableEntityException(
          'Accepted voice note draft has no text',
        );
      }
    }

    const notes = mechanicNotes?.trim() ?? '';
    if (!notes) {
      throw new UnprocessableEntityException(
        'Save diagnostic notes before submitting a finding to the advisor',
      );
    }

    return notes;
  }

  private async resolveAuthorizedMedia(
    tenantId: string,
    siteId: string,
    mechanicId: string,
    taskId: string,
    orderId: string,
    mediaIds: string[],
  ): Promise<FindingMediaRef[]> {
    if (mediaIds.length === 0) {
      return [];
    }

    const uniqueIds = [...new Set(mediaIds)];
    const rows = await this.prisma.workshopMedia.findMany({
      where: {
        tenant_id: tenantId,
        id: { in: uniqueIds },
        workshop_task_id: taskId,
        workshop_order_id: orderId,
        uploaded_by_employee_id: mechanicId,
        workshop_order: { site_id: siteId },
      },
      select: {
        id: true,
        mime_type: true,
        caption: true,
      },
    });

    if (rows.length !== uniqueIds.length) {
      throw new UnprocessableEntityException(
        'One or more media items are not authorized for this task',
      );
    }

    return rows.map((row) => ({
      id: row.id,
      mime_type: row.mime_type,
      caption: row.caption,
    }));
  }
}
