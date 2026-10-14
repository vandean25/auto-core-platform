import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Prisma,
  WorkshopEstimateStatus,
  WorkshopOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../common/services/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import type {
  RecordWorkshopOverrunNoticeDto,
  WorkshopOverrunNoticeDto,
} from './dto/record-workshop-overrun-notice.dto.js';
import type { WorkshopEstimateResponseDto } from './dto/workshop-estimate-response.dto.js';
import { WorkshopEstimateOverrunService } from './workshop-estimate-overrun.service.js';
import { WorkshopEstimateService } from './workshop-estimate.service.js';
import {
  resolveActorUserId,
  resolveEstimateScope,
  type EstimateScope,
} from './workshop-estimate-scope.js';

/**
 * The advisor's notice to the customer about an overrun (AUT-355, ADR-0025 §1). The notice is written against the
 * approved baseline the warning was measured from, and only once. It is an advisor record, not a message: nothing is
 * sent from here.
 */
@Injectable()
export class WorkshopOverrunNoticeService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
    @Inject(SiteContextService)
    private readonly siteContext: SiteContextService,
    @Inject(WorkshopEstimateService)
    private readonly estimates: WorkshopEstimateService,
    @Inject(WorkshopEstimateOverrunService)
    private readonly overruns: WorkshopEstimateOverrunService,
  ) {}

  async recordNotice(
    orderId: string,
    dto: RecordWorkshopOverrunNoticeDto,
  ): Promise<WorkshopOverrunNoticeDto> {
    const scope = await resolveEstimateScope({
      prisma: this.prisma,
      tenantContext: this.tenantContext,
      siteContext: this.siteContext,
    });
    const actorUserId = await resolveActorUserId({
      prisma: this.prisma,
      tenantContext: this.tenantContext,
      tenantId: scope.tenantId,
    });
    await this.assertOrderOpen(scope, orderId);

    // Reading the estimate records the overrun first if it has not been seen yet, so the notice always has one.
    const estimate = await this.currentEstimate(orderId);
    const warning = estimate.overrun_warning;
    if (!warning) {
      throw new ConflictException({
        code: 'OVERRUN_NOT_DETECTED',
        message: 'The order has no overrun against its approved estimate.',
      });
    }
    if (!warning.requires_customer_notice) {
      throw new ConflictException({
        code: 'OVERRUN_ALREADY_NOTIFIED',
        message: 'The customer was already informed about this overrun.',
      });
    }
    assertNoticeAmount(dto.amount_quoted_gross, warning.current_total_gross);

    const baseline = latestApprovedVersion(estimate);
    const row = await this.overruns.recordNotice({
      tenantId: scope.tenantId,
      baselineVersionId: baseline.id,
      actorUserId,
      channel: dto.channel,
      amountGross: dto.amount_quoted_gross,
      reaction: dto.customer_reaction,
      note: dto.note,
    });
    return {
      id: row.id,
      version: baseline.version,
      notified_at: (row.notified_at ?? new Date()).toISOString(),
      channel: dto.channel,
      amount_quoted_gross: dto.amount_quoted_gross,
      customer_reaction: dto.customer_reaction,
      note: dto.note,
    };
  }

  private async assertOrderOpen(
    scope: EstimateScope,
    orderId: string,
  ): Promise<void> {
    const order = await this.prisma.workshopOrder.findFirst({
      where: { id: orderId, tenant_id: scope.tenantId, site_id: scope.siteId },
      select: { status: true },
    });
    if (!order) {
      throw new NotFoundException('Workshop order not found');
    }
    if (order.status === WorkshopOrderStatus.INVOICED) {
      throw new ConflictException({
        code: 'WORKSHOP_ORDER_CLOSED',
        message: 'An invoiced order takes no overrun notice.',
      });
    }
  }

  private async currentEstimate(
    orderId: string,
  ): Promise<WorkshopEstimateResponseDto> {
    const list = await this.estimates.listForOrder(orderId);
    const estimate = list.data[0];
    if (!estimate) {
      throw new NotFoundException('Workshop estimate not found');
    }
    return estimate;
  }
}

/** The customer is told the gross total the order has now. A different amount is a different offer. */
function assertNoticeAmount(quoted: string, currentTotal: string): void {
  if (!new Prisma.Decimal(quoted).equals(new Prisma.Decimal(currentTotal))) {
    throw new UnprocessableEntityException({
      code: 'OVERRUN_AMOUNT_MISMATCH',
      message: `The amount quoted (${quoted}) does not match the current order total (${currentTotal}).`,
      expected_amount_gross: currentTotal,
    });
  }
}

/** The baseline is the approved version with the highest version number. */
function latestApprovedVersion(estimate: WorkshopEstimateResponseDto): {
  id: string;
  version: number;
} {
  const approved = estimate.versions
    .filter((version) => version.status === WorkshopEstimateStatus.APPROVED)
    .sort((a, b) => b.version - a.version)[0];
  if (!approved) {
    throw new ConflictException({
      code: 'OVERRUN_NO_BASELINE',
      message:
        'The estimate has no approved version to measure the overrun from.',
    });
  }
  return { id: approved.id, version: approved.version };
}
