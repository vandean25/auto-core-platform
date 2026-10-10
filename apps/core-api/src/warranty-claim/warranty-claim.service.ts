import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AuditLogAction,
  Prisma,
  WarrantyClaimStatus,
  WorkshopOrderStatus,
  WorkshopPartLineExecutionStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import type {
  CreateWarrantyClaimDto,
  ListWarrantyClaimsQueryDto,
  UpdateWarrantyClaimDto,
} from './dto/warranty-claim.dto.js';
import {
  toWarrantyClaimResponse,
  type WarrantyClaimResponse,
  type WarrantyClaimRow,
} from './warranty-claim.mapper.js';
import {
  WARRANTY_CLAIM_ERROR_CODES,
  assertWarrantyClaimAccess,
  assertWarrantyClaimDecisionDate,
  assertWarrantyClaimSubmittable,
  assertWarrantyClaimTransition,
  computeLineNetAmount,
  diffWarrantyClaimSnapshots,
  isWarrantyClaimContentEditable,
  normalizeWarrantyClaimText,
  parseWarrantyClaimDay,
} from './warranty-claim.rules.js';

const WARRANTY_CLAIM_ENTITY_TYPE = 'WarrantyClaim';
const WARRANTY_CLAIM_AUDIT_SOURCE = 'API';

/** Database access used by the claim writes. Both the base client and a transaction satisfy it. */
type WarrantyClaimDb = Pick<
  Prisma.TransactionClient,
  'user' | 'workshopTaskLineItem' | 'warrantyClaim' | 'warrantyClaimLine'
>;

function claimInclude(tenantId: string) {
  return {
    lines: {
      where: { tenant_id: tenantId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    },
  } satisfies Prisma.WarrantyClaimInclude;
}

function toDecimalOrNull(value: number | null): Prisma.Decimal | null {
  return value === null ? null : new Prisma.Decimal(value);
}

function sameDecimal(
  a: Prisma.Decimal | null,
  b: Prisma.Decimal | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.equals(b);
}

function sameDay(a: Date | null, b: Date | null): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/**
 * Garantie/Kulanz claim file on a workshop order (AUT-464). Internal record only: the claim is
 * filed with the OEM outside this system. Access is limited to owners, admins and the advisor
 * (tenant role SALES); every write is audit-logged in the same transaction as the change.
 */
@Injectable()
export class WarrantyClaimService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly auditService: AuditService,
  ) {}

  async list(
    orderId: string,
    query: ListWarrantyClaimsQueryDto,
  ): Promise<{ data: WarrantyClaimResponse[]; meta: { total: number } }> {
    const { tenantId, siteId } = await this.resolveScope();
    await this.findOrderInSite(tenantId, siteId, orderId);

    const statuses = query.status ?? [];
    const rows = await this.prisma.warrantyClaim.findMany({
      where: {
        tenant_id: tenantId,
        workshop_order_id: orderId,
        ...(statuses.length > 0 ? { status: { in: statuses } } : {}),
      },
      include: claimInclude(tenantId),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const data = rows.map((row) => toWarrantyClaimResponse(row));
    return { data, meta: { total: data.length } };
  }

  async get(orderId: string, claimId: string): Promise<WarrantyClaimResponse> {
    const { tenantId, siteId } = await this.resolveScope();
    await this.findOrderInSite(tenantId, siteId, orderId);
    return toWarrantyClaimResponse(
      await this.loadClaimRow(this.prisma, tenantId, orderId, claimId),
    );
  }

  async create(
    orderId: string,
    dto: CreateWarrantyClaimDto,
  ): Promise<WarrantyClaimResponse> {
    const { tenantId, siteId } = await this.resolveScope();
    const order = await this.findOrderInSite(tenantId, siteId, orderId);
    if (order.status === WorkshopOrderStatus.SCHEDULED) {
      throw new UnprocessableEntityException({
        code: WARRANTY_CLAIM_ERROR_CODES.ORDER_NOT_CHECKED_IN,
        message:
          'Warranty claims can be filed once the order has been checked in.',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const actorUserId = await this.findAuditActorId(tx, tenantId);
      const created = await tx.warrantyClaim.create({
        data: {
          tenant_id: tenantId,
          workshop_order_id: orderId,
          type: dto.type,
          status: WarrantyClaimStatus.DRAFT,
          complaint: normalizeWarrantyClaimText(dto.complaint ?? null),
          cause_correction: normalizeWarrantyClaimText(
            dto.causeCorrection ?? null,
          ),
          claimed_amount_net: toDecimalOrNull(dto.claimedAmountNet ?? null),
        },
        select: { id: true },
      });

      if (dto.lineItemIds !== undefined) {
        await this.replaceLines(
          tx,
          tenantId,
          orderId,
          created.id,
          dto.lineItemIds,
        );
      }

      const after = toWarrantyClaimResponse(
        await this.loadClaimRow(tx, tenantId, orderId, created.id),
      );
      await this.auditService.recordTenantMutation(
        {
          entityType: WARRANTY_CLAIM_ENTITY_TYPE,
          entityId: created.id,
          action: AuditLogAction.CREATE,
          actorUserId,
          source: WARRANTY_CLAIM_AUDIT_SOURCE,
          after,
        },
        tx,
      );
      return after;
    });
  }

  async update(
    orderId: string,
    claimId: string,
    dto: UpdateWarrantyClaimDto,
  ): Promise<WarrantyClaimResponse> {
    const { tenantId, siteId } = await this.resolveScope();
    await this.findOrderInSite(tenantId, siteId, orderId);

    return this.prisma.$transaction(async (tx) => {
      const current = await this.loadClaimRow(tx, tenantId, orderId, claimId);
      const before = toWarrantyClaimResponse(current);

      // Resolve every requested value up front, so the rules run before anything is written.
      const next = {
        type: dto.type ?? current.type,
        status: dto.status ?? current.status,
        complaint:
          dto.complaint !== undefined
            ? normalizeWarrantyClaimText(dto.complaint)
            : current.complaint,
        causeCorrection:
          dto.causeCorrection !== undefined
            ? normalizeWarrantyClaimText(dto.causeCorrection)
            : current.cause_correction,
        claimedAmountNet:
          dto.claimedAmountNet !== undefined
            ? toDecimalOrNull(dto.claimedAmountNet)
            : current.claimed_amount_net,
        externalReference:
          dto.externalReference !== undefined
            ? normalizeWarrantyClaimText(dto.externalReference)
            : current.external_reference,
        decisionNote:
          dto.decisionNote !== undefined
            ? normalizeWarrantyClaimText(dto.decisionNote)
            : current.decision_note,
        decisionDate:
          dto.decisionDate !== undefined
            ? dto.decisionDate === null
              ? null
              : parseWarrantyClaimDay(dto.decisionDate)
            : current.decision_date,
      };
      const requestedLineIds =
        dto.lineItemIds !== undefined
          ? [...new Set(dto.lineItemIds)]
          : undefined;
      const linesChanged =
        requestedLineIds !== undefined &&
        !sameIds(
          requestedLineIds,
          current.lines.map((line) => line.workshop_task_line_item_id),
        );

      const contentChanged =
        next.type !== current.type ||
        next.complaint !== current.complaint ||
        next.causeCorrection !== current.cause_correction ||
        !sameDecimal(next.claimedAmountNet, current.claimed_amount_net) ||
        linesChanged;
      const metadataChanged =
        next.externalReference !== current.external_reference ||
        next.decisionNote !== current.decision_note ||
        !sameDay(next.decisionDate, current.decision_date);
      const statusChanged = next.status !== current.status;

      if (
        current.status === WarrantyClaimStatus.CLOSED &&
        (contentChanged || metadataChanged || statusChanged)
      ) {
        throw new ConflictException({
          code: WARRANTY_CLAIM_ERROR_CODES.CLOSED,
          message: 'A closed warranty claim is read-only.',
        });
      }
      if (contentChanged && !isWarrantyClaimContentEditable(current.status)) {
        throw new ConflictException({
          code: WARRANTY_CLAIM_ERROR_CODES.LOCKED,
          message:
            'The claim content is locked after submission. Only the external reference and the decision can still change.',
        });
      }

      const lineCount = requestedLineIds?.length ?? current.lines.length;
      if (statusChanged) {
        assertWarrantyClaimTransition(current.status, next.status);
        if (next.status === WarrantyClaimStatus.SUBMITTED_EXTERNALLY) {
          assertWarrantyClaimSubmittable({
            complaint: next.complaint,
            claimedAmountNet: next.claimedAmountNet,
            lineCount,
          });
        }
      }
      assertWarrantyClaimDecisionDate(next.status, next.decisionDate);

      const actorUserId = await this.findAuditActorId(tx, tenantId);

      // Guarded write first: it takes the claim row lock and fails if the status moved meanwhile.
      const now = new Date();
      const result = await tx.warrantyClaim.updateMany({
        where: {
          id: claimId,
          tenant_id: tenantId,
          workshop_order_id: orderId,
          status: current.status,
        },
        data: {
          type: next.type,
          status: next.status,
          complaint: next.complaint,
          cause_correction: next.causeCorrection,
          claimed_amount_net: next.claimedAmountNet,
          external_reference: next.externalReference,
          decision_note: next.decisionNote,
          decision_date: next.decisionDate,
          ...(statusChanged &&
          next.status === WarrantyClaimStatus.SUBMITTED_EXTERNALLY
            ? { submitted_at: now }
            : {}),
          ...(statusChanged && next.status === WarrantyClaimStatus.CLOSED
            ? { closed_at: now }
            : {}),
        },
      });
      if (result.count !== 1) {
        throw new ConflictException({
          code: WARRANTY_CLAIM_ERROR_CODES.STATE_CHANGED,
          message:
            'The warranty claim changed while you were editing. Reload it and try again.',
        });
      }

      if (requestedLineIds !== undefined && linesChanged) {
        await this.replaceLines(
          tx,
          tenantId,
          orderId,
          claimId,
          requestedLineIds,
        );
      }

      const after = toWarrantyClaimResponse(
        await this.loadClaimRow(tx, tenantId, orderId, claimId),
      );
      const diff = diffWarrantyClaimSnapshots(before, after);
      if (Object.keys(diff).length > 0) {
        await this.auditService.recordTenantMutation(
          {
            entityType: WARRANTY_CLAIM_ENTITY_TYPE,
            entityId: claimId,
            action: AuditLogAction.UPDATE,
            actorUserId,
            source: WARRANTY_CLAIM_AUDIT_SOURCE,
            before,
            after,
            diff,
          },
          tx,
        );
      }
      return after;
    });
  }

  /** Scope for every claim call: an advisor or admin with an active site. */
  private async resolveScope(): Promise<{ tenantId: string; siteId: string }> {
    assertWarrantyClaimAccess(this.tenantContext);
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    return { tenantId, siteId };
  }

  /** Claims hang off a site-owned order, so the order is always resolved through the active site. */
  private async findOrderInSite(
    tenantId: string,
    siteId: string,
    orderId: string,
  ): Promise<{ id: string; status: WorkshopOrderStatus }> {
    const order = await this.prisma.workshopOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId, site_id: siteId },
      select: { id: true, status: true },
    });
    if (!order) {
      throw new NotFoundException(`Workshop order ${orderId} not found`);
    }
    return order;
  }

  private async loadClaimRow(
    db: WarrantyClaimDb,
    tenantId: string,
    orderId: string,
    claimId: string,
  ): Promise<WarrantyClaimRow> {
    const row = await db.warrantyClaim.findFirst({
      where: { id: claimId, tenant_id: tenantId, workshop_order_id: orderId },
      include: claimInclude(tenantId),
    });
    if (!row) {
      throw new NotFoundException(`Warranty claim ${claimId} not found`);
    }
    return row;
  }

  private async findAuditActorId(
    db: WarrantyClaimDb,
    tenantId: string,
  ): Promise<string | undefined> {
    const authUser = this.tenantContext.getAuthenticatedUser();
    if (!authUser?.userId) return undefined;
    const actor = await db.user.findFirst({
      where: { firebaseUid: authUser.userId, active_tenant_id: tenantId },
      select: { id: true },
    });
    return actor?.id;
  }

  /**
   * Replaces the lines of a DRAFT claim with a snapshot of the given order lines. Every line must
   * belong to this order, must not be cancelled, and must not sit on another open claim.
   */
  private async replaceLines(
    db: WarrantyClaimDb,
    tenantId: string,
    orderId: string,
    claimId: string,
    lineItemIds: string[],
  ): Promise<number> {
    const ids = [...new Set(lineItemIds)];
    const lineItems =
      ids.length === 0
        ? []
        : await db.workshopTaskLineItem.findMany({
            where: {
              id: { in: ids },
              tenant_id: tenantId,
              workshop_task: {
                tenant_id: tenantId,
                workshop_order_id: orderId,
              },
            },
            select: {
              id: true,
              type: true,
              item_no: true,
              description: true,
              quantity: true,
              unit_price: true,
              part_execution_status: true,
            },
          });

    if (lineItems.length !== ids.length) {
      throw new UnprocessableEntityException({
        code: WARRANTY_CLAIM_ERROR_CODES.LINE_NOT_ON_ORDER,
        message:
          'Every affected line must be a labor or part line of this workshop order.',
      });
    }
    if (
      lineItems.some(
        (line) =>
          line.part_execution_status ===
          WorkshopPartLineExecutionStatus.CANCELLED,
      )
    ) {
      throw new UnprocessableEntityException({
        code: WARRANTY_CLAIM_ERROR_CODES.LINE_CANCELLED,
        message: 'Cancelled part lines cannot be claimed.',
      });
    }

    if (ids.length > 0) {
      const claimedElsewhere = await db.warrantyClaimLine.findFirst({
        where: {
          tenant_id: tenantId,
          workshop_task_line_item_id: { in: ids },
          warranty_claim: {
            tenant_id: tenantId,
            id: { not: claimId },
            status: { not: WarrantyClaimStatus.CLOSED },
          },
        },
        select: { workshop_task_line_item_id: true },
      });
      if (claimedElsewhere) {
        throw new ConflictException({
          code: WARRANTY_CLAIM_ERROR_CODES.LINE_ALREADY_CLAIMED,
          message:
            'A line can belong to one open warranty claim at a time. Close the other claim first.',
        });
      }
    }

    await db.warrantyClaimLine.deleteMany({
      where: { tenant_id: tenantId, warranty_claim_id: claimId },
    });
    if (lineItems.length > 0) {
      await db.warrantyClaimLine.createMany({
        data: lineItems.map((line) => ({
          tenant_id: tenantId,
          warranty_claim_id: claimId,
          workshop_task_line_item_id: line.id,
          line_type: line.type,
          item_no: line.item_no,
          description: line.description,
          quantity: line.quantity,
          unit_price: line.unit_price,
          net_amount: computeLineNetAmount(line.quantity, line.unit_price),
        })),
      });
    }
    return lineItems.length;
  }
}
