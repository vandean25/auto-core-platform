import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AgentPolicyTier,
  AgentProposalStatus,
  Prisma,
  WorkshopLineItemType,
  type AgentProposal,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import { AgentPolicyService } from '../agent-policy/agent-policy.service.js';
import type { AgentPolicyEvaluateContext } from '../agent-policy/agent-policy.types.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
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
        expires_at: { gt: now },
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
      if (
        reloaded.status === AgentProposalStatus.EXPIRED ||
        (reloaded.status === AgentProposalStatus.PENDING &&
          reloaded.expires_at <= now)
      ) {
        if (reloaded.status === AgentProposalStatus.PENDING) {
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

    const policyContext = this.extractPolicyContext(
      proposal.payload_json,
      proposal.action_type,
    );
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
        expires_at: { gt: now },
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
        reloaded.status === AgentProposalStatus.EXPIRED ||
        (reloaded.status === AgentProposalStatus.PENDING &&
          reloaded.expires_at <= now)
      ) {
        if (reloaded.status === AgentProposalStatus.PENDING) {
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
        data: {
          status: AgentProposalStatus.FAILED,
          reason: error instanceof Error ? error.message : 'Execution failed',
        },
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

  resolveLineItemFinancials(record: Record<string, unknown>): {
    unitPrice: number;
    totalAmount: number;
    quantity: number;
  } {
    return resolveLineItemFinancials(record);
  }

  private extractPolicyContext(
    payload: unknown,
    actionType?: string,
  ): AgentPolicyEvaluateContext {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {};
    }
    const record = payload as Record<string, unknown>;
    const context: AgentPolicyEvaluateContext = {};

    if (actionType === 'workshop_order.add_line') {
      const financials = resolveLineItemFinancials(record);
      if (financials.totalAmount > 0) {
        context.amount_eur = financials.totalAmount;
      }
    } else {
      let amountEur: number | undefined;
      if (
        typeof record.amount_eur === 'number' &&
        Number.isFinite(record.amount_eur)
      ) {
        amountEur = record.amount_eur;
      } else if (
        typeof record.amountEur === 'number' &&
        Number.isFinite(record.amountEur)
      ) {
        amountEur = record.amountEur;
      } else if (
        typeof record.amount === 'number' &&
        Number.isFinite(record.amount)
      ) {
        amountEur = record.amount;
      } else if (
        typeof record.amount_cents === 'number' &&
        Number.isFinite(record.amount_cents)
      ) {
        amountEur = record.amount_cents / 100;
      } else if (
        typeof record.amountCents === 'number' &&
        Number.isFinite(record.amountCents)
      ) {
        amountEur = record.amountCents / 100;
      }

      if (typeof amountEur === 'number') {
        context.amount_eur = amountEur;
      }
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
      const nested = this.extractPolicyContext(record.context, actionType);
      return { ...nested, ...context };
    }

    return context;
  }

  private async dispatchActionPayload(
    actionType: string,
    payload: unknown,
    tenantId: string,
  ): Promise<Record<string, unknown>> {
    const record =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};

    switch (actionType) {
      case 'workshop_order.add_line': {
        const orderId =
          (record.order_id as string | undefined) ??
          (record.orderId as string | undefined) ??
          (record.workshop_order_id as string | undefined) ??
          (record.workshopOrderId as string | undefined);
        if (!orderId) {
          throw new BadRequestException(
            'workshop_order.add_line payload requires order_id',
          );
        }

        const callerSiteId = await this.siteContext.getSiteId();
        const payloadSiteId =
          (record.site_id as string | undefined) ??
          (record.siteId as string | undefined);
        if (payloadSiteId && payloadSiteId !== callerSiteId) {
          throw new BadRequestException(
            `Action payload site (${payloadSiteId}) does not match caller authorized site (${callerSiteId})`,
          );
        }

        const order = await this.prisma.workshopOrder.findFirst({
          where: {
            id: orderId,
            tenant_id: tenantId,
            site_id: callerSiteId,
          },
          include: {
            tasks: {
              orderBy: { createdAt: 'asc' },
            },
          },
        });
        if (!order) {
          throw new NotFoundException(`Workshop order ${orderId} not found`);
        }

        const taskId =
          (record.task_id as string | undefined) ??
          (record.taskId as string | undefined);
        let targetTask = taskId
          ? order.tasks?.find((t) => t.id === taskId)
          : order.tasks?.[0];

        if (!targetTask) {
          if (taskId) {
            throw new NotFoundException(
              `Workshop task ${taskId} not found on order ${orderId}`,
            );
          }
          targetTask = await this.prisma.workshopTask.create({
            data: {
              tenant_id: tenantId,
              workshop_order_id: order.id,
              title: 'General Service',
            },
          });
        }

        const type =
          record.type === 'LABOR'
            ? WorkshopLineItemType.LABOR
            : WorkshopLineItemType.PART;
        const itemNo =
          typeof record.item_no === 'string'
            ? record.item_no
            : typeof record.itemNo === 'string'
              ? record.itemNo
              : 'MISC';
        const description =
          typeof record.description === 'string'
            ? record.description
            : 'Proposed line item';

        const financials = resolveLineItemFinancials(record);
        const quantity = new Prisma.Decimal(financials.quantity);
        const unitPrice = new Prisma.Decimal(financials.unitPrice);

        const lineItem = await this.prisma.workshopTaskLineItem.create({
          data: {
            tenant_id: tenantId,
            workshop_task_id: targetTask.id,
            type,
            item_no: itemNo,
            description,
            quantity,
            unit_price: unitPrice,
          },
        });

        return {
          actionType,
          status: 'SUCCESS',
          entityType: 'WorkshopTaskLineItem',
          entityId: lineItem.id,
          orderId: order.id,
          siteId: callerSiteId,
          taskId: targetTask.id,
          lineItem,
        };
      }

      case 'customer.update': {
        const customerId =
          (record.customer_id as string | undefined) ??
          (record.customerId as string | undefined);
        if (!customerId) {
          throw new BadRequestException(
            'customer.update payload requires customer_id',
          );
        }

        const customer = await this.prisma.customer.findFirst({
          where: { id: customerId, tenant_id: tenantId },
        });
        if (!customer) {
          throw new NotFoundException(`Customer ${customerId} not found`);
        }

        const updateData: Prisma.CustomerUpdateInput = {};
        if (typeof record.first_name === 'string') {
          updateData.first_name = record.first_name;
        }
        if (typeof record.last_name === 'string') {
          updateData.last_name = record.last_name;
        }
        if (typeof record.email === 'string') {
          updateData.email = record.email;
        }
        if (typeof record.phone === 'string') {
          updateData.phone = record.phone;
        }

        const updatedCustomer = await this.prisma.customer.update({
          where: { id: customer.id },
          data: updateData,
        });

        return {
          actionType,
          status: 'SUCCESS',
          entityType: 'Customer',
          entityId: updatedCustomer.id,
        };
      }

      default:
        throw new BadRequestException(
          `Unsupported action type for automatic execution: ${actionType}`,
        );
    }
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

export interface LineItemFinancials {
  unitPrice: number;
  totalAmount: number;
  quantity: number;
}

export function resolveLineItemFinancials(
  record: Record<string, unknown>,
): LineItemFinancials {
  const quantity =
    typeof record.quantity === 'number' &&
    Number.isFinite(record.quantity) &&
    record.quantity > 0
      ? record.quantity
      : 1;

  let unitPriceFromPayload: number | undefined;
  if (
    typeof record.unit_price === 'number' &&
    Number.isFinite(record.unit_price)
  ) {
    unitPriceFromPayload = record.unit_price;
  } else if (
    typeof record.unitPrice === 'number' &&
    Number.isFinite(record.unitPrice)
  ) {
    unitPriceFromPayload = record.unitPrice;
  } else if (
    typeof record.unit_price_cents === 'number' &&
    Number.isFinite(record.unit_price_cents)
  ) {
    unitPriceFromPayload = record.unit_price_cents / 100;
  } else if (
    typeof record.unitPriceCents === 'number' &&
    Number.isFinite(record.unitPriceCents)
  ) {
    unitPriceFromPayload = record.unitPriceCents / 100;
  }

  let totalAmountFromPayload: number | undefined;
  if (
    typeof record.amount_eur === 'number' &&
    Number.isFinite(record.amount_eur)
  ) {
    totalAmountFromPayload = record.amount_eur;
  } else if (
    typeof record.amountEur === 'number' &&
    Number.isFinite(record.amountEur)
  ) {
    totalAmountFromPayload = record.amountEur;
  } else if (
    typeof record.amount === 'number' &&
    Number.isFinite(record.amount)
  ) {
    totalAmountFromPayload = record.amount;
  } else if (
    typeof record.amount_cents === 'number' &&
    Number.isFinite(record.amount_cents)
  ) {
    totalAmountFromPayload = record.amount_cents / 100;
  } else if (
    typeof record.amountCents === 'number' &&
    Number.isFinite(record.amountCents)
  ) {
    totalAmountFromPayload = record.amountCents / 100;
  }

  if (
    unitPriceFromPayload !== undefined &&
    totalAmountFromPayload !== undefined
  ) {
    const expectedTotal = unitPriceFromPayload * quantity;
    if (Math.abs(expectedTotal - totalAmountFromPayload) > 0.01) {
      throw new BadRequestException(
        `Payload amount (${totalAmountFromPayload}) contradicts unit_price (${unitPriceFromPayload}) * quantity (${quantity}) = ${expectedTotal}`,
      );
    }
    return {
      unitPrice: unitPriceFromPayload,
      totalAmount: totalAmountFromPayload,
      quantity,
    };
  }

  if (unitPriceFromPayload !== undefined) {
    return {
      unitPrice: unitPriceFromPayload,
      totalAmount: unitPriceFromPayload * quantity,
      quantity,
    };
  }

  if (totalAmountFromPayload !== undefined) {
    return {
      unitPrice: totalAmountFromPayload / quantity,
      totalAmount: totalAmountFromPayload,
      quantity,
    };
  }

  return {
    unitPrice: 0,
    totalAmount: 0,
    quantity,
  };
}
