import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AgentPolicyTier,
  AgentProposalStatus,
  Prisma,
  type AgentProposal,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import { AgentPolicyService } from '../agent-policy/agent-policy.service.js';
import type { AgentPolicyEvaluateContext } from '../agent-policy/agent-policy.types.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { requireActiveCurrentUser } from '../site/site.authorization.js';
import { assertSupervisorAccess } from './agent-proposal.authorization.js';
import type {
  AgentProposalListResponseDto,
  AgentProposalResponseDto,
  CreateAgentProposalDto,
  QueryAgentProposalsDto,
  RejectAgentProposalDto,
} from './dto/agent-proposal.dto.js';

@Injectable()
export class AgentProposalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly agentPolicyService: AgentPolicyService,
    private readonly agentActionLog: AgentActionLogService,
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

    return {
      data: proposals.map((proposal) => this.toResponseDto(proposal)),
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

    return this.toResponseDto(proposal);
  }

  async rejectProposal(
    id: string,
    dto?: RejectAgentProposalDto,
  ): Promise<AgentProposalResponseDto> {
    assertSupervisorAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const currentUser = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    const proposal = await this.prisma.agentProposal.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!proposal) {
      throw new NotFoundException('Proposal not found');
    }

    if (
      proposal.status === AgentProposalStatus.EXPIRED ||
      (proposal.status === AgentProposalStatus.PENDING &&
        proposal.expires_at < new Date())
    ) {
      if (proposal.status === AgentProposalStatus.PENDING) {
        await this.prisma.agentProposal.updateMany({
          where: {
            id: proposal.id,
            tenant_id: tenantId,
            status: AgentProposalStatus.PENDING,
          },
          data: { status: AgentProposalStatus.EXPIRED },
        });
      }
      throw new UnprocessableEntityException('Proposal has expired');
    }

    if (proposal.status === AgentProposalStatus.REJECTED) {
      return this.toResponseDto(proposal);
    }

    if (
      proposal.status === AgentProposalStatus.APPROVED ||
      proposal.status === AgentProposalStatus.EXECUTED
    ) {
      throw new ConflictException(
        `Proposal is already ${proposal.status.toLowerCase()}`,
      );
    }

    if (proposal.status === AgentProposalStatus.FAILED) {
      throw new ConflictException('Proposal has failed and cannot be rejected');
    }

    const now = new Date();
    const updated = await this.prisma.agentProposal.updateMany({
      where: {
        id: proposal.id,
        tenant_id: tenantId,
        status: AgentProposalStatus.PENDING,
      },
      data: {
        status: AgentProposalStatus.REJECTED,
        decided_by: currentUser.id,
        decided_at: now,
        reason: dto?.reason ?? null,
      },
    });

    if (updated.count === 0) {
      const reloaded = await this.prisma.agentProposal.findFirst({
        where: { id: proposal.id, tenant_id: tenantId },
      });
      if (!reloaded) {
        throw new NotFoundException('Proposal not found');
      }
      if (reloaded.status === AgentProposalStatus.REJECTED) {
        return this.toResponseDto(reloaded);
      }
      throw new ConflictException(
        `Proposal state conflict: current status is ${reloaded.status}`,
      );
    }

    await this.agentActionLog.record({
      traceId: proposal.trace_id,
      actorType: 'USER',
      onBehalfOfUserId: currentUser.id,
      actionType: proposal.action_type,
      tier: 'PROPOSE',
      status: 'REJECTED',
      inputSummary: { proposalId: proposal.id, reason: dto?.reason },
      resultSummary: { rejectedBy: currentUser.id, reason: dto?.reason },
    });

    const finalProposal = await this.prisma.agentProposal.findFirst({
      where: { id: proposal.id, tenant_id: tenantId },
    });
    return this.toResponseDto(finalProposal!);
  }

  async approveProposal(id: string): Promise<AgentProposalResponseDto> {
    assertSupervisorAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const currentUser = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    const proposal = await this.prisma.agentProposal.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!proposal) {
      throw new NotFoundException('Proposal not found');
    }

    if (
      proposal.status === AgentProposalStatus.EXPIRED ||
      (proposal.status === AgentProposalStatus.PENDING &&
        proposal.expires_at < new Date())
    ) {
      if (proposal.status === AgentProposalStatus.PENDING) {
        await this.prisma.agentProposal.updateMany({
          where: {
            id: proposal.id,
            tenant_id: tenantId,
            status: AgentProposalStatus.PENDING,
          },
          data: { status: AgentProposalStatus.EXPIRED },
        });
      }
      throw new UnprocessableEntityException('Proposal has expired');
    }

    if (
      proposal.status === AgentProposalStatus.APPROVED ||
      proposal.status === AgentProposalStatus.EXECUTED
    ) {
      return this.toResponseDto(proposal);
    }

    if (
      proposal.status === AgentProposalStatus.REJECTED ||
      proposal.status === AgentProposalStatus.FAILED
    ) {
      throw new ConflictException(
        `Proposal is in status ${proposal.status} and cannot be approved`,
      );
    }

    const policyContext = this.extractPolicyContext(proposal.payload_json);
    const evalResult = await this.agentPolicyService.evaluate(
      {
        action_type: proposal.action_type,
        context: policyContext,
      },
      { skipAdminCheck: true },
    );

    if (evalResult.tier === AgentPolicyTier.HUMAN_ONLY) {
      throw new UnprocessableEntityException(
        'Action requires human execution or exceeds policy limits: ' +
          evalResult.reasons.join(', '),
      );
    }

    const now = new Date();
    const updated = await this.prisma.agentProposal.updateMany({
      where: {
        id: proposal.id,
        tenant_id: tenantId,
        status: AgentProposalStatus.PENDING,
      },
      data: {
        status: AgentProposalStatus.APPROVED,
        decided_by: currentUser.id,
        decided_at: now,
      },
    });

    if (updated.count === 0) {
      const reloaded = await this.prisma.agentProposal.findFirst({
        where: { id: proposal.id, tenant_id: tenantId },
      });
      if (!reloaded) {
        throw new NotFoundException('Proposal not found');
      }
      if (
        reloaded.status === AgentProposalStatus.APPROVED ||
        reloaded.status === AgentProposalStatus.EXECUTED
      ) {
        return this.toResponseDto(reloaded);
      }
      throw new ConflictException(
        `Proposal state conflict: current status is ${reloaded.status}`,
      );
    }

    try {
      await this.agentActionLog.record(
        {
          traceId: proposal.trace_id,
          actorType: 'USER',
          onBehalfOfUserId: currentUser.id,
          actionType: proposal.action_type,
          tier: 'PROPOSE',
          status: 'EXECUTED',
          inputSummary: {
            proposalId: proposal.id,
            payload: proposal.payload_json,
          },
          resultSummary: { approvedBy: currentUser.id, executed: true },
        },
        async () => {
          return this.dispatchActionPayload(
            proposal.action_type,
            proposal.payload_json,
            tenantId,
          );
        },
      );

      await this.prisma.agentProposal.updateMany({
        where: { id: proposal.id, tenant_id: tenantId },
        data: { status: AgentProposalStatus.EXECUTED },
      });

      const executedProposal = await this.prisma.agentProposal.findFirst({
        where: { id: proposal.id, tenant_id: tenantId },
      });
      return this.toResponseDto(executedProposal!);
    } catch (error) {
      await this.prisma.agentProposal.updateMany({
        where: { id: proposal.id, tenant_id: tenantId },
        data: { status: AgentProposalStatus.FAILED },
      });
      throw error;
    }
  }

  async createProposal(
    dto: CreateAgentProposalDto,
  ): Promise<AgentProposalResponseDto> {
    assertSupervisorAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const traceId = dto.trace_id ?? randomUUID();

    const created = await this.prisma.agentProposal.create({
      data: {
        tenant_id: tenantId,
        trace_id: traceId,
        action_type: dto.action_type,
        payload_json: dto.payload_json as Prisma.InputJsonValue,
        preview_json: dto.preview_json
          ? (dto.preview_json as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        tier: dto.tier ?? AgentPolicyTier.PROPOSE,
        status: AgentProposalStatus.PENDING,
      },
    });

    return this.toResponseDto(created);
  }

  private extractPolicyContext(payload: unknown): AgentPolicyEvaluateContext {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {};
    }
    const record = payload as Record<string, unknown>;
    const context: AgentPolicyEvaluateContext = {};

    const amount =
      typeof record.amount_eur === 'number'
        ? record.amount_eur
        : typeof record.amountEur === 'number'
          ? record.amountEur
          : typeof record.amount === 'number'
            ? record.amount
            : undefined;
    if (typeof amount === 'number') {
      context.amount_eur = amount;
    }

    const customerFacing =
      typeof record.customer_facing === 'boolean'
        ? record.customer_facing
        : typeof record.customerFacing === 'boolean'
          ? record.customerFacing
          : undefined;
    if (typeof customerFacing === 'boolean') {
      context.customer_facing = customerFacing;
    }

    const reversible =
      typeof record.reversible === 'boolean' ? record.reversible : undefined;
    if (typeof reversible === 'boolean') {
      context.reversible = reversible;
    }

    const affectsLegal =
      typeof record.affects_legal_document === 'boolean'
        ? record.affects_legal_document
        : typeof record.affectsLegalDocument === 'boolean'
          ? record.affectsLegalDocument
          : undefined;
    if (typeof affectsLegal === 'boolean') {
      context.affects_legal_document = affectsLegal;
    }

    if (
      record.context &&
      typeof record.context === 'object' &&
      !Array.isArray(record.context)
    ) {
      const nested = this.extractPolicyContext(record.context);
      return { ...nested, ...context };
    }

    return context;
  }

  private dispatchActionPayload(
    actionType: string,
    payload: unknown,
    tenantId: string,
  ): Promise<Record<string, unknown>> {
    return Promise.resolve({
      actionType,
      executedAt: new Date().toISOString(),
      tenantId,
      status: 'SUCCESS',
      payload,
    });
  }

  private toResponseDto(proposal: AgentProposal): AgentProposalResponseDto {
    return {
      id: proposal.id,
      tenant_id: proposal.tenant_id,
      trace_id: proposal.trace_id,
      action_type: proposal.action_type,
      tier: proposal.tier,
      status: proposal.status,
      payload_json: (proposal.payload_json ?? {}) as Record<string, unknown>,
      preview_json: (proposal.preview_json ?? null) as Record<
        string,
        unknown
      > | null,
      decided_by: proposal.decided_by,
      decided_at: proposal.decided_at
        ? proposal.decided_at.toISOString()
        : null,
      reason: proposal.reason,
      expires_at: proposal.expires_at.toISOString(),
      created_at: proposal.createdAt.toISOString(),
      updated_at: proposal.updatedAt.toISOString(),
    };
  }
}
