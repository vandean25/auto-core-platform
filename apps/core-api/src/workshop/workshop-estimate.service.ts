import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, WorkshopEstimateStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../common/services/site-context.service.js';
import { assertSiteReadAccess } from '../site/site.authorization.js';
import { computeSellerReadiness } from '../site/legal-entity-readiness.js';
import {
  collectCustomerMissingFields,
  resolveBrandingSnapshot,
} from '../invoices/invoice-snapshot-v2.helpers.js';
import type {
  WorkshopEstimateDraftPreviewDto,
  WorkshopEstimateListResponseDto,
  WorkshopEstimateResponseDto,
  WorkshopEstimateVersionDetailDto,
} from './dto/workshop-estimate-response.dto.js';
import {
  WORKSHOP_ESTIMATE_OPEN_ORDER_STATUSES,
  isCustomerEstimateSendEnabled,
} from './workshop-estimate.constants.js';
import {
  calendarYearInVienna,
  generateWorkshopEstimateNumber,
} from './workshop-estimate-number.helpers.js';
import {
  buildWorkshopEstimateLines,
  buildWorkshopEstimateTotals,
  collectEstimateSourceLines,
} from './workshop-estimate-lines.helpers.js';
import {
  buildWorkshopEstimateSnapshot,
  buildWorkshopEstimateValidityWindow,
  hashWorkshopEstimateSnapshot,
  type WorkshopEstimateSnapshot,
} from './workshop-estimate-snapshot.js';
import {
  computeWorkshopEstimateOverrun,
  type WorkshopEstimateOverrunWarning,
} from './workshop-estimate-overrun.helpers.js';
import { retainUntilAtSend } from './workshop-estimate-retention.helpers.js';
import {
  WORKSHOP_ESTIMATE_VERSION_SUMMARY_SELECT,
  toWorkshopEstimateDto,
  toWorkshopEstimateDraftPreviewDto,
  toWorkshopEstimateVersionDetailDto,
} from './workshop-estimate-response.mapper.js';
import { lockWorkshopRows } from './workshop-task.helpers.js';

/** Estimate actions are for back-office roles. TECH sessions are refused (ADR-0014 §8.2 and AUT-354). */
const ESTIMATE_ROLES: ReadonlySet<string> = new Set([
  'OWNER',
  'ADMIN',
  'SALES',
]);
const DEFAULT_OVERRUN_THRESHOLD_PCT = '15';

type EstimateScope = { tenantId: string; siteId: string };

const ORDER_FOR_ESTIMATE_SELECT = {
  id: true,
  site_id: true,
  status: true,
  order_number: true,
  odometer: true,
  customer: true,
  vehicle: {
    select: { make: true, model: true, year: true, vin: true, plate: true },
  },
  tasks: {
    orderBy: { sequence: 'asc' },
    select: {
      id: true,
      line_items: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          type: true,
          item_no: true,
          description: true,
          quantity: true,
          unit_price: true,
          part_execution_status: true,
        },
      },
    },
  },
} satisfies Prisma.WorkshopOrderSelect;

type OrderForEstimate = Prisma.WorkshopOrderGetPayload<{
  select: typeof ORDER_FOR_ESTIMATE_SELECT;
}>;

type EstimateDbClient = Pick<Prisma.TransactionClient, 'workshopOrder'>;

function mapEstimateWriteError(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    throw new ConflictException({
      code: 'ESTIMATE_CONFLICT',
      message:
        'The estimate changed while it was being saved. Reload it and try again.',
    });
  }
  throw error;
}

function isDueForExpiry(
  version: { status: WorkshopEstimateStatus; valid_until: Date | null },
  now: Date,
): boolean {
  return (
    version.status === WorkshopEstimateStatus.SENT &&
    version.valid_until !== null &&
    version.valid_until.getTime() < now.getTime()
  );
}

@Injectable()
export class WorkshopEstimateService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
    @Inject(SiteContextService)
    private readonly siteContext: SiteContextService,
  ) {}

  /** Create the estimate (KV number, version 1 as DRAFT) for an open workshop order. */
  async createForOrder(orderId: string): Promise<WorkshopEstimateResponseDto> {
    const scope = await this.resolveScope();
    const estimateId = await this.prisma
      .$transaction(async (tx) => {
        await this.loadOrderForWrite(tx, scope, orderId);
        const existing = await tx.workshopEstimate.findFirst({
          where: { tenant_id: scope.tenantId, workshop_order_id: orderId },
          select: { id: true },
        });
        if (existing) {
          throw new ConflictException({
            code: 'ESTIMATE_ALREADY_EXISTS',
            message:
              'This workshop order already has an estimate. Create a revision instead.',
          });
        }

        const year = calendarYearInVienna(new Date());
        const estimateNumber = await generateWorkshopEstimateNumber(
          tx,
          scope.tenantId,
          year,
        );
        const created = await tx.workshopEstimate.create({
          data: {
            tenant_id: scope.tenantId,
            site_id: scope.siteId,
            workshop_order_id: orderId,
            estimate_number: estimateNumber,
            year,
            // tenant_id and estimate_id come from the parent: they are part of the
            // composite relation key, so Prisma does not accept them in a nested create.
            versions: {
              create: {
                version: 1,
                status: WorkshopEstimateStatus.DRAFT,
              },
            },
          },
          select: { id: true },
        });
        return created.id;
      })
      .catch(mapEstimateWriteError);

    return this.readEstimate(scope, estimateId);
  }

  async listForOrder(
    orderId: string,
  ): Promise<WorkshopEstimateListResponseDto> {
    const scope = await this.resolveScope();
    await this.findOrderInScope(this.prisma, scope, orderId);
    const estimate = await this.prisma.workshopEstimate.findFirst({
      where: {
        tenant_id: scope.tenantId,
        workshop_order_id: orderId,
        site_id: scope.siteId,
      },
      select: { id: true },
    });
    if (!estimate) {
      return { data: [] };
    }
    return { data: [await this.readEstimate(scope, estimate.id)] };
  }

  /** New DRAFT version under the same KV number. The previous versions stay readable. */
  async createRevision(
    orderId: string,
  ): Promise<WorkshopEstimateVersionDetailDto> {
    const scope = await this.resolveScope();
    const versionId = await this.prisma
      .$transaction(async (tx) => {
        await this.loadOrderForWrite(tx, scope, orderId);
        const estimate = await tx.workshopEstimate.findFirst({
          where: {
            tenant_id: scope.tenantId,
            workshop_order_id: orderId,
            site_id: scope.siteId,
          },
          select: {
            id: true,
            versions: {
              orderBy: { version: 'desc' },
              take: 1,
              select: { version: true, status: true },
            },
          },
        });
        if (!estimate) {
          throw new NotFoundException('Workshop estimate not found');
        }
        const latest = estimate.versions[0];
        if (!latest) {
          throw new ConflictException({
            code: 'ESTIMATE_VERSION_MISSING',
            message: 'The estimate has no version to revise.',
          });
        }
        if (latest.status === WorkshopEstimateStatus.DRAFT) {
          throw new ConflictException({
            code: 'ESTIMATE_DRAFT_OPEN',
            message:
              'The current draft must be sent before a revision can be created.',
          });
        }

        const created = await tx.workshopEstimateVersion.create({
          data: {
            tenant_id: scope.tenantId,
            estimate_id: estimate.id,
            version: latest.version + 1,
            status: WorkshopEstimateStatus.DRAFT,
          },
          select: { id: true },
        });
        return created.id;
      })
      .catch(mapEstimateWriteError);

    return this.readVersion(scope, versionId);
  }

  async getVersion(
    versionId: string,
  ): Promise<WorkshopEstimateVersionDetailDto> {
    const scope = await this.resolveScope();
    return this.readVersion(scope, versionId);
  }

  /**
   * DRAFT -> SENT. Freezes the snapshot, its SHA-256, the validity window and the
   * retention date in one atomic update, and supersedes the previously sent version.
   * The branding is read-only ADR-0024 data and does not depend on the invoice
   * branding writer flag (ADR-0025 §3).
   */
  async sendVersion(
    versionId: string,
  ): Promise<WorkshopEstimateVersionDetailDto> {
    this.assertEstimateRole();
    if (!isCustomerEstimateSendEnabled()) {
      throw new ServiceUnavailableException({
        code: 'ESTIMATE_SEND_DISABLED',
        message:
          'Sending estimates to customers is disabled until the legal copy is approved.',
      });
    }
    const scope = await this.resolveScope();

    await this.prisma
      .$transaction(async (tx) => {
        const version = await tx.workshopEstimateVersion.findFirst({
          where: {
            id: versionId,
            tenant_id: scope.tenantId,
            estimate: { site_id: scope.siteId },
          },
          select: {
            id: true,
            estimate_id: true,
            version: true,
            status: true,
            estimate: {
              select: { estimate_number: true, workshop_order_id: true },
            },
          },
        });
        if (!version) {
          throw new NotFoundException('Workshop estimate version not found');
        }
        if (version.status !== WorkshopEstimateStatus.DRAFT) {
          throw new ConflictException({
            code: 'ESTIMATE_NOT_DRAFT',
            message: 'Only a draft estimate version can be sent.',
          });
        }

        const order = await this.loadAndLockOrderForWrite(
          tx,
          scope,
          version.estimate.workshop_order_id,
        );
        const lines = buildWorkshopEstimateLines(
          collectEstimateSourceLines(order.tasks),
        );
        if (lines.length === 0) {
          throw new UnprocessableEntityException({
            code: 'ESTIMATE_NO_LINES',
            message: 'The estimate needs at least one labor or parts line.',
          });
        }
        if (!order.customer) {
          throw new UnprocessableEntityException({
            code: 'ESTIMATE_CUSTOMER_REQUIRED',
            message: 'The workshop order needs a customer before sending.',
          });
        }
        const missingCustomer = collectCustomerMissingFields(order.customer);
        if (missingCustomer.length > 0) {
          throw new UnprocessableEntityException({
            code: 'ESTIMATE_CUSTOMER_INCOMPLETE',
            message: 'Customer details are incomplete for the estimate.',
            missingFields: missingCustomer,
          });
        }

        const site = await tx.site.findFirst({
          where: { id: scope.siteId, tenant_id: scope.tenantId },
          select: { legal_entity: true },
        });
        if (!site) {
          throw new NotFoundException('Workshop order site not found');
        }
        const legalEntity = site.legal_entity;
        const readiness = computeSellerReadiness(legalEntity);
        if (!readiness.isReady) {
          throw new UnprocessableEntityException({
            code: 'SELLER_IDENTITY_INCOMPLETE',
            message: 'Seller identity is incomplete for the estimate.',
            missingFields: readiness.missingFields,
          });
        }

        const issuedAt = new Date();
        const { validFrom, validUntil } =
          buildWorkshopEstimateValidityWindow(issuedAt);
        const branding = await resolveBrandingSnapshot(
          tx,
          scope.tenantId,
          legalEntity.id,
          issuedAt,
          { lockLogo: true },
        );
        const totals = buildWorkshopEstimateTotals(lines);
        const snapshot = buildWorkshopEstimateSnapshot({
          estimateNumber: version.estimate.estimate_number,
          version: version.version,
          issuedAt,
          validFrom,
          validUntil,
          freeOfCharge: true,
          seller: legalEntity,
          customer: order.customer,
          vehicle: {
            make: order.vehicle.make,
            model: order.vehicle.model,
            year: order.vehicle.year,
            vin: order.vehicle.vin,
            plate: order.vehicle.plate,
          },
          order: {
            order_number: order.order_number,
            odometer: order.odometer,
          },
          lines,
          totals,
          branding,
        });

        await tx.workshopEstimateVersion.updateMany({
          where: {
            tenant_id: scope.tenantId,
            estimate_id: version.estimate_id,
            status: WorkshopEstimateStatus.SENT,
            id: { not: versionId },
          },
          data: { status: WorkshopEstimateStatus.SUPERSEDED },
        });

        const sent = await tx.workshopEstimateVersion.updateMany({
          where: {
            id: versionId,
            tenant_id: scope.tenantId,
            status: WorkshopEstimateStatus.DRAFT,
          },
          data: {
            status: WorkshopEstimateStatus.SENT,
            legal_entity_id: legalEntity.id,
            sent_at: issuedAt,
            valid_from: validFrom,
            valid_until: validUntil,
            total_net: new Prisma.Decimal(totals.total_net),
            total_tax: new Prisma.Decimal(totals.total_tax),
            total_gross: new Prisma.Decimal(totals.total_gross),
            snapshot: snapshot,
            snapshot_sha256: hashWorkshopEstimateSnapshot(snapshot),
            legal_text_version: snapshot.legal.text_version,
            legal_text_sha256: snapshot.legal.text_sha256,
            retain_until: retainUntilAtSend(issuedAt),
          },
        });
        if (sent.count !== 1) {
          throw new ConflictException({
            code: 'ESTIMATE_NOT_DRAFT',
            message: 'Only a draft estimate version can be sent.',
          });
        }

        if (branding.logo) {
          await tx.workshopEstimateBrandAssetReference.create({
            data: {
              tenant_id: scope.tenantId,
              legal_entity_id: legalEntity.id,
              workshop_estimate_version_id: versionId,
              asset_id: branding.logo.asset_id,
            },
          });
        }
      })
      .catch(mapEstimateWriteError);

    return this.readVersion(scope, versionId);
  }

  private assertEstimateRole(): void {
    const user = this.tenantContext.getAuthenticatedUser();
    if (!user?.role || !ESTIMATE_ROLES.has(user.role)) {
      throw new ForbiddenException({
        code: 'ESTIMATE_ROLE_FORBIDDEN',
        message:
          'Kostenvoranschlag actions require the owner, admin or sales role.',
      });
    }
  }

  private async resolveScope(): Promise<EstimateScope> {
    this.assertEstimateRole();
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    await assertSiteReadAccess(
      this.prisma,
      this.tenantContext,
      tenantId,
      siteId,
    );
    return { tenantId, siteId };
  }

  private async findOrderInScope(
    client: EstimateDbClient,
    scope: EstimateScope,
    orderId: string,
  ): Promise<OrderForEstimate> {
    const order = await client.workshopOrder.findFirst({
      where: { id: orderId, tenant_id: scope.tenantId, site_id: scope.siteId },
      select: ORDER_FOR_ESTIMATE_SELECT,
    });
    if (!order) {
      throw new NotFoundException('Workshop order not found');
    }
    return order;
  }

  /** Writes only touch orders still in intake or in progress (COMPLETED and INVOICED are closed). */
  private async loadOrderForWrite(
    client: EstimateDbClient,
    scope: EstimateScope,
    orderId: string,
  ): Promise<OrderForEstimate> {
    const order = await this.findOrderInScope(client, scope, orderId);
    if (!WORKSHOP_ESTIMATE_OPEN_ORDER_STATUSES.includes(order.status)) {
      throw new ConflictException({
        code: 'WORKSHOP_ORDER_NOT_ESTIMATABLE',
        message: `Estimates can only be created or sent while the order is ${WORKSHOP_ESTIMATE_OPEN_ORDER_STATUSES.join(' or ')}.`,
      });
    }
    return order;
  }

  /**
   * Locks the order's task rows with the task-first lock that line edits take,
   * then reads the order again. The lines frozen into a snapshot therefore never
   * come from a line edit that is still committing (same pattern as the invoice path).
   */
  private async loadAndLockOrderForWrite(
    tx: Prisma.TransactionClient,
    scope: EstimateScope,
    orderId: string,
  ): Promise<OrderForEstimate> {
    const order = await this.loadOrderForWrite(tx, scope, orderId);
    await lockWorkshopRows({
      tx,
      tableName: 'workshop_tasks',
      tenantId: scope.tenantId,
      ids: order.tasks.map((task) => task.id),
      siteId: scope.siteId,
    });
    return this.loadOrderForWrite(tx, scope, orderId);
  }

  private async expireDueVersions(
    tenantId: string,
    estimateId: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.workshopEstimateVersion.updateMany({
      where: {
        tenant_id: tenantId,
        estimate_id: estimateId,
        status: WorkshopEstimateStatus.SENT,
        valid_until: { lt: now },
      },
      data: { status: WorkshopEstimateStatus.EXPIRED },
    });
  }

  private async readEstimate(
    scope: EstimateScope,
    estimateId: string,
  ): Promise<WorkshopEstimateResponseDto> {
    const now = new Date();
    await this.expireDueVersions(scope.tenantId, estimateId, now);

    const estimate = await this.prisma.workshopEstimate.findFirst({
      where: {
        id: estimateId,
        tenant_id: scope.tenantId,
        site_id: scope.siteId,
      },
      select: {
        id: true,
        workshop_order_id: true,
        estimate_number: true,
        year: true,
        createdAt: true,
        versions: {
          orderBy: { version: 'asc' },
          select: WORKSHOP_ESTIMATE_VERSION_SUMMARY_SELECT,
        },
      },
    });
    if (!estimate) {
      throw new NotFoundException('Workshop estimate not found');
    }

    const [order, approved, settings] = await Promise.all([
      this.findOrderInScope(this.prisma, scope, estimate.workshop_order_id),
      this.prisma.workshopEstimateVersion.findFirst({
        where: {
          tenant_id: scope.tenantId,
          estimate_id: estimateId,
          status: WorkshopEstimateStatus.APPROVED,
        },
        orderBy: { version: 'desc' },
        select: { snapshot: true },
      }),
      this.prisma.financeSettings.findFirst({
        where: { tenant_id: scope.tenantId },
        select: { estimate_overrun_threshold_pct: true },
      }),
    ]);

    const thresholdPct =
      settings?.estimate_overrun_threshold_pct.toFixed(2) ??
      DEFAULT_OVERRUN_THRESHOLD_PCT;
    const approvedSnapshot = approved?.snapshot as unknown as
      WorkshopEstimateSnapshot | null | undefined;
    const overrun: WorkshopEstimateOverrunWarning | null = approvedSnapshot
      ? computeWorkshopEstimateOverrun({
          approved: {
            total_gross: approvedSnapshot.totals.total_gross,
            lines: approvedSnapshot.lines,
          },
          currentLines: buildWorkshopEstimateLines(
            collectEstimateSourceLines(order.tasks),
          ),
          thresholdPct,
        })
      : null;

    return toWorkshopEstimateDto({
      estimate,
      overrun,
      sendEnabled: isCustomerEstimateSendEnabled(),
      thresholdPct,
    });
  }

  private async readVersion(
    scope: EstimateScope,
    versionId: string,
  ): Promise<WorkshopEstimateVersionDetailDto> {
    const version = await this.prisma.workshopEstimateVersion.findFirst({
      where: {
        id: versionId,
        tenant_id: scope.tenantId,
        estimate: { site_id: scope.siteId },
      },
      select: {
        ...WORKSHOP_ESTIMATE_VERSION_SUMMARY_SELECT,
        estimate_id: true,
        snapshot: true,
        estimate: {
          select: {
            id: true,
            estimate_number: true,
            workshop_order_id: true,
          },
        },
      },
    });
    if (!version) {
      throw new NotFoundException('Workshop estimate version not found');
    }

    const now = new Date();
    await this.expireDueVersions(scope.tenantId, version.estimate_id, now);
    const status = isDueForExpiry(version, now)
      ? WorkshopEstimateStatus.EXPIRED
      : version.status;

    let draftPreview: WorkshopEstimateDraftPreviewDto | null = null;
    if (version.status === WorkshopEstimateStatus.DRAFT) {
      const order = await this.findOrderInScope(
        this.prisma,
        scope,
        version.estimate.workshop_order_id,
      );
      const lines = buildWorkshopEstimateLines(
        collectEstimateSourceLines(order.tasks),
      );
      draftPreview = toWorkshopEstimateDraftPreviewDto(
        lines,
        buildWorkshopEstimateTotals(lines),
      );
    }

    return toWorkshopEstimateVersionDetailDto({
      version: { ...version, status },
      estimate: version.estimate,
      draftPreview,
    });
  }
}
