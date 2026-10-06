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
import { assertOrderEditable } from '../workshop/workshop-order.helpers.js';
import { incrementTaskLineItemsVersion } from '../workshop/workshop-task-line-items.helpers.js';
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
    const rejectedProposal = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.agentProposal.updateMany({
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
      if (updated.count === 0) return null;

      await this.agentActionLog.recordInTransaction(
        {
          traceId: proposal.trace_id,
          actorType: 'USER',
          agentId: this.getOriginatingAgentId(proposal.payload_json),
          onBehalfOfUserId: currentUser.id,
          actionType: proposal.action_type,
          tier: 'PROPOSE',
          status: 'REJECTED',
          inputSummary: { proposalId: proposal.id, reason: dto?.reason },
          resultSummary: { rejectedBy: currentUser.id, reason: dto?.reason },
        },
        tx,
      );

      return tx.agentProposal.findFirst({
        where: { id: proposal.id, tenant_id: tenantId },
      });
    });
    if (rejectedProposal) return this.toResponseDto(rejectedProposal);

    const reloaded = await this.prisma.agentProposal.findFirst({
      where: { id: proposal.id, tenant_id: tenantId },
    });
    if (!reloaded) throw new NotFoundException('Proposal not found');
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

    if (proposal.tier === AgentPolicyTier.HUMAN_ONLY) {
      throw new UnprocessableEntityException(
        'HUMAN_ONLY proposals must be performed manually',
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
    let claimed = false;
    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.agentProposal.updateMany({
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
        if (updated.count === 0) return { claimed: false as const };
        claimed = true;

        await this.agentActionLog.recordInTransaction(
          {
            traceId: proposal.trace_id,
            actorType: 'USER',
            agentId: this.getOriginatingAgentId(proposal.payload_json),
            onBehalfOfUserId: currentUser.id,
            actionType: proposal.action_type,
            tier: 'PROPOSE',
            status: 'EXECUTED',
            inputSummary: {
              proposalId: proposal.id,
              payload: proposal.payload_json,
            },
            resultSummary: (result?: Record<string, unknown>) => ({
              approvedBy: currentUser.id,
              executed: true,
              entityId: result?.entityId,
            }),
          },
          tx,
          () =>
            this.dispatchActionPayload(
              proposal.action_type,
              proposal.payload_json,
              tenantId,
              tx,
            ),
        );

        await tx.agentProposal.updateMany({
          where: {
            id: proposal.id,
            tenant_id: tenantId,
            status: AgentProposalStatus.APPROVED,
          },
          data: { status: AgentProposalStatus.EXECUTED },
        });
        const executedProposal = await tx.agentProposal.findFirst({
          where: { id: proposal.id, tenant_id: tenantId },
        });
        if (!executedProposal) {
          throw new NotFoundException('Proposal not found');
        }
        return { claimed: true as const, proposal: executedProposal };
      });

      if (outcome.claimed) return this.toResponseDto(outcome.proposal);

      const reloaded = await this.prisma.agentProposal.findFirst({
        where: { id: proposal.id, tenant_id: tenantId },
      });
      if (!reloaded) throw new NotFoundException('Proposal not found');
      if (
        reloaded.status === AgentProposalStatus.PENDING &&
        reloaded.expires_at <= now
      ) {
        await this.prisma.agentProposal.updateMany({
          where: {
            id: proposal.id,
            tenant_id: tenantId,
            status: AgentProposalStatus.PENDING,
          },
          data: { status: AgentProposalStatus.EXPIRED },
        });
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
    } catch (error) {
      if (claimed) {
        try {
          await this.prisma.$transaction(async (tx) => {
            const failed = await tx.agentProposal.updateMany({
              where: {
                id: proposal.id,
                tenant_id: tenantId,
                status: AgentProposalStatus.PENDING,
              },
              data: {
                status: AgentProposalStatus.FAILED,
                reason:
                  error instanceof Error ? error.message : 'Execution failed',
              },
            });
            if (failed.count === 0) return;
            await this.agentActionLog.recordInTransaction(
              {
                traceId: proposal.trace_id,
                actorType: 'USER',
                agentId: this.getOriginatingAgentId(proposal.payload_json),
                onBehalfOfUserId: currentUser.id,
                actionType: proposal.action_type,
                tier: 'PROPOSE',
                status: 'FAILED',
                inputSummary: { proposalId: proposal.id },
                resultSummary: {
                  approvedBy: currentUser.id,
                  error:
                    error instanceof Error ? error.message : 'Execution failed',
                },
              },
              tx,
            );
          });
        } catch {
          // The failed state remains recoverable as PENDING if audit persistence is unavailable.
        }
      }
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
      context.amount_eur = financials.totalAmount;
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
        if (amountEur < 0) {
          throw new BadRequestException('Amount cannot be negative');
        }
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
    tx: Prisma.TransactionClient,
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

        const siteLock = await tx.site.updateMany({
          where: {
            id: callerSiteId,
            tenant_id: tenantId,
            is_active: true,
          },
          data: { is_active: true },
        });
        if (siteLock.count !== 1) {
          throw new UnprocessableEntityException(
            'The active site is no longer available',
          );
        }

        const order = await tx.workshopOrder.findFirst({
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

        assertOrderEditable(order);

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
          targetTask = await tx.workshopTask.create({
            data: {
              tenant_id: tenantId,
              workshop_order_id: order.id,
              title: 'General Service',
            },
          });
        }

        let expectedVersion = targetTask.line_items_version;
        if (
          typeof record.expected_line_items_version === 'number' &&
          Number.isFinite(record.expected_line_items_version)
        ) {
          expectedVersion = record.expected_line_items_version;
        } else if (
          typeof record.expectedLineItemsVersion === 'number' &&
          Number.isFinite(record.expectedLineItemsVersion)
        ) {
          expectedVersion = record.expectedLineItemsVersion;
        }

        await incrementTaskLineItemsVersion({
          tx,
          tenantId,
          siteId: callerSiteId,
          taskId: targetTask.id,
          expectedLineItemsVersion: expectedVersion,
        });

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

        const lineItem = await tx.workshopTaskLineItem.create({
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

        const customer = await tx.customer.findFirst({
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

        const updateResult = await tx.customer.updateMany({
          where: { id: customer.id, tenant_id: tenantId },
          data: updateData,
        });
        if (updateResult.count === 0) {
          throw new NotFoundException(`Customer ${customerId} not found`);
        }

        const updatedCustomer = await tx.customer.findFirst({
          where: { id: customer.id, tenant_id: tenantId },
        });

        return {
          actionType,
          status: 'SUCCESS',
          entityType: 'Customer',
          entityId: updatedCustomer!.id,
          customer: updatedCustomer,
        };
      }

      default:
        throw new BadRequestException(
          `Unsupported action type for automatic execution: ${actionType}`,
        );
    }
  }

  private getOriginatingAgentId(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return undefined;
    }
    const record = payload as Record<string, unknown>;
    const agentId = record.agent_id ?? record.agentId;
    return typeof agentId === 'string' && agentId.length > 0
      ? agentId
      : undefined;
  }

  private buildEffectiveSummary(
    actionType: string,
    payload: Record<string, unknown>,
  ): {
    target_type: string | null;
    target_id: string | null;
    amount_eur: number | null;
  } {
    const firstString = (keys: string[]) => {
      for (const key of keys) {
        if (typeof payload[key] === 'string') return payload[key];
      }
      return null;
    };
    const targetType =
      actionType === 'customer.update'
        ? 'Customer'
        : actionType === 'workshop_order.add_line'
          ? 'WorkshopOrder'
          : firstString(['entity_type', 'entityType']);
    const targetId =
      actionType === 'customer.update'
        ? firstString(['customer_id', 'customerId'])
        : actionType === 'workshop_order.add_line'
          ? firstString([
              'order_id',
              'orderId',
              'workshop_order_id',
              'workshopOrderId',
            ])
          : firstString(['entity_id', 'entityId']);

    let amountEur: number | null = null;
    try {
      const amount = this.extractPolicyContext(payload, actionType).amount_eur;
      if (typeof amount === 'number') amountEur = amount;
    } catch {
      amountEur = null;
    }

    return {
      target_type: targetType,
      target_id: targetId,
      amount_eur: amountEur,
    };
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
      effective_summary: this.buildEffectiveSummary(
        proposal.action_type,
        (proposal.payload_json ?? {}) as Record<string, unknown>,
      ),
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
  let quantity = 1;
  if (record.quantity !== undefined) {
    if (
      typeof record.quantity !== 'number' ||
      !Number.isFinite(record.quantity) ||
      record.quantity <= 0
    ) {
      throw new BadRequestException(
        'Line item quantity must be a positive number',
      );
    }
    quantity = record.quantity;
  }

  let unitPriceFromPayload: number | undefined;
  if (record.unit_price !== undefined) {
    if (
      typeof record.unit_price !== 'number' ||
      !Number.isFinite(record.unit_price)
    ) {
      throw new BadRequestException(
        'Line item unit_price must be a valid number',
      );
    }
    if (record.unit_price < 0) {
      throw new BadRequestException('Line item unit_price cannot be negative');
    }
    unitPriceFromPayload = record.unit_price;
  } else if (record.unitPrice !== undefined) {
    if (
      typeof record.unitPrice !== 'number' ||
      !Number.isFinite(record.unitPrice)
    ) {
      throw new BadRequestException(
        'Line item unit_price must be a valid number',
      );
    }
    if (record.unitPrice < 0) {
      throw new BadRequestException('Line item unit_price cannot be negative');
    }
    unitPriceFromPayload = record.unitPrice;
  } else if (record.unit_price_cents !== undefined) {
    if (
      typeof record.unit_price_cents !== 'number' ||
      !Number.isFinite(record.unit_price_cents)
    ) {
      throw new BadRequestException(
        'Line item unit_price must be a valid number',
      );
    }
    if (record.unit_price_cents < 0) {
      throw new BadRequestException('Line item unit_price cannot be negative');
    }
    unitPriceFromPayload = record.unit_price_cents / 100;
  } else if (record.unitPriceCents !== undefined) {
    if (
      typeof record.unitPriceCents !== 'number' ||
      !Number.isFinite(record.unitPriceCents)
    ) {
      throw new BadRequestException(
        'Line item unit_price must be a valid number',
      );
    }
    if (record.unitPriceCents < 0) {
      throw new BadRequestException('Line item unit_price cannot be negative');
    }
    unitPriceFromPayload = record.unitPriceCents / 100;
  }

  let totalAmountFromPayload: number | undefined;
  if (record.amount_eur !== undefined) {
    if (
      typeof record.amount_eur !== 'number' ||
      !Number.isFinite(record.amount_eur)
    ) {
      throw new BadRequestException('Line item amount must be a valid number');
    }
    if (record.amount_eur < 0) {
      throw new BadRequestException('Line item amount cannot be negative');
    }
    totalAmountFromPayload = record.amount_eur;
  } else if (record.amountEur !== undefined) {
    if (
      typeof record.amountEur !== 'number' ||
      !Number.isFinite(record.amountEur)
    ) {
      throw new BadRequestException('Line item amount must be a valid number');
    }
    if (record.amountEur < 0) {
      throw new BadRequestException('Line item amount cannot be negative');
    }
    totalAmountFromPayload = record.amountEur;
  } else if (record.amount !== undefined) {
    if (typeof record.amount !== 'number' || !Number.isFinite(record.amount)) {
      throw new BadRequestException('Line item amount must be a valid number');
    }
    if (record.amount < 0) {
      throw new BadRequestException('Line item amount cannot be negative');
    }
    totalAmountFromPayload = record.amount;
  } else if (record.amount_cents !== undefined) {
    if (
      typeof record.amount_cents !== 'number' ||
      !Number.isFinite(record.amount_cents)
    ) {
      throw new BadRequestException('Line item amount must be a valid number');
    }
    if (record.amount_cents < 0) {
      throw new BadRequestException('Line item amount cannot be negative');
    }
    totalAmountFromPayload = record.amount_cents / 100;
  } else if (record.amountCents !== undefined) {
    if (
      typeof record.amountCents !== 'number' ||
      !Number.isFinite(record.amountCents)
    ) {
      throw new BadRequestException('Line item amount must be a valid number');
    }
    if (record.amountCents < 0) {
      throw new BadRequestException('Line item amount cannot be negative');
    }
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
