import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  type EstimateCustomerReaction,
  type EstimateNotificationChannel,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { WorkshopEstimateOverrunWarning } from './workshop-estimate-overrun.helpers.js';
import {
  toOverrunView,
  type OverrunTrackingRow,
  type WorkshopEstimateOverrunView,
} from './workshop-estimate-overrun-tracking.helpers.js';
import { recordFirstDetection } from './workshop-estimate-overrun-sync.js';

const OVERRUN_ROW_SELECT = {
  id: true,
  detected_at: true,
  approved_total_gross: true,
  detected_total_gross: true,
  notified_at: true,
  notified_channel: true,
  notified_amount_gross: true,
  customer_reaction: true,
  note: true,
} satisfies Prisma.WorkshopEstimateOverrunSelect;

export type OverrunNoticeInput = {
  tenantId: string;
  baselineVersionId: string;
  actorUserId: string;
  channel: EstimateNotificationChannel;
  amountGross: string;
  reaction: EstimateCustomerReaction;
  note: string;
};

/**
 * Tracks the overrun of one approved baseline (ADR-0025 §1, AUT-355). The first detection is written once, with its
 * audit row, in a transaction. A customer notice is written by a guarded update, and a notice is repeated only when
 * the total has changed since the last one. Every change is in the audit trail, since the audit extension covers the
 * updates.
 */
@Injectable()
export class WorkshopEstimateOverrunService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Returns the live warning with its tracked state. The first time an overrun is seen against a baseline, its
   * detection time and the figures at that moment are stored, so later reads show when it began.
   */
  async observe(
    tenantId: string,
    baselineVersionId: string,
    warning: WorkshopEstimateOverrunWarning,
  ): Promise<WorkshopEstimateOverrunView> {
    const row =
      (await this.findRow(tenantId, baselineVersionId)) ??
      (await this.detect(tenantId, baselineVersionId, warning));
    return toOverrunView(warning, row);
  }

  async findRow(
    tenantId: string,
    baselineVersionId: string,
  ): Promise<OverrunTrackingRow | null> {
    return this.prisma.workshopEstimateOverrun.findFirst({
      where: {
        tenant_id: tenantId,
        workshop_estimate_version_id: baselineVersionId,
      },
      select: OVERRUN_ROW_SELECT,
    });
  }

  /**
   * Writes the customer notice. It is refused when the same amount was already noticed (409), and it replaces the
   * last notice when the total has moved since then.
   */
  async recordNotice(input: OverrunNoticeInput): Promise<OverrunTrackingRow> {
    const amount = new Prisma.Decimal(input.amountGross);
    const updated = await this.prisma.workshopEstimateOverrun.updateMany({
      where: {
        tenant_id: input.tenantId,
        workshop_estimate_version_id: input.baselineVersionId,
        OR: [{ notified_at: null }, { notified_amount_gross: { not: amount } }],
      },
      data: {
        notified_at: new Date(),
        notified_channel: input.channel,
        notified_by_user_id: input.actorUserId,
        notified_amount_gross: amount,
        customer_reaction: input.reaction,
        note: input.note,
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException({
        code: 'OVERRUN_ALREADY_NOTIFIED',
        message: 'The customer was already informed about this total.',
      });
    }
    const row = await this.findRow(input.tenantId, input.baselineVersionId);
    if (!row) {
      throw new InternalServerErrorException(
        'The overrun record disappeared after the customer notice was written.',
      );
    }
    return row;
  }

  private async detect(
    tenantId: string,
    baselineVersionId: string,
    warning: WorkshopEstimateOverrunWarning,
  ): Promise<OverrunTrackingRow> {
    await recordFirstDetection(
      this.prisma,
      tenantId,
      baselineVersionId,
      warning,
    );
    const row = await this.findRow(tenantId, baselineVersionId);
    if (!row) {
      throw new InternalServerErrorException(
        'The overrun record was not written for the approved baseline.',
      );
    }
    return row;
  }
}
