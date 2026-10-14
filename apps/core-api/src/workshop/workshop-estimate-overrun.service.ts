import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  AuditLogAction,
  type EstimateCustomerReaction,
  type EstimateNotificationChannel,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { WorkshopEstimateOverrunWarning } from './workshop-estimate-overrun.helpers.js';
import {
  toOverrunView,
  type OverrunTrackingRow,
  type WorkshopEstimateOverrunView,
} from './workshop-estimate-overrun-tracking.helpers.js';

const OVERRUN_ROW_SELECT = {
  id: true,
  detected_at: true,
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
 * Tracks the overrun of one approved baseline (ADR-0025 §1, AUT-355). The first detection is written once, and the
 * customer notice is written once, by a guarded update. Both are audited, since the audit extension does not cover
 * creates.
 */
@Injectable()
export class WorkshopEstimateOverrunService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

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

  /** Writes the customer notice once. A second notice for the same baseline finds notified_at set and is refused. */
  async recordNotice(input: OverrunNoticeInput): Promise<OverrunTrackingRow> {
    const updated = await this.prisma.workshopEstimateOverrun.updateMany({
      where: {
        tenant_id: input.tenantId,
        workshop_estimate_version_id: input.baselineVersionId,
        notified_at: null,
      },
      data: {
        notified_at: new Date(),
        notified_channel: input.channel,
        notified_by_user_id: input.actorUserId,
        notified_amount_gross: new Prisma.Decimal(input.amountGross),
        customer_reaction: input.reaction,
        note: input.note,
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException({
        code: 'OVERRUN_ALREADY_NOTIFIED',
        message: 'The customer was already informed about this overrun.',
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
    const created = await this.prisma.workshopEstimateOverrun.createMany({
      data: [
        {
          tenant_id: tenantId,
          workshop_estimate_version_id: baselineVersionId,
          detected_at: new Date(),
          approved_total_gross: new Prisma.Decimal(
            warning.approved_total_gross,
          ),
          detected_total_gross: new Prisma.Decimal(warning.current_total_gross),
          total_over_threshold: warning.total_over_threshold,
          new_work_lines: warning.new_work_lines,
        },
      ],
      skipDuplicates: true,
    });
    const row = await this.findRow(tenantId, baselineVersionId);
    if (!row) {
      throw new InternalServerErrorException(
        'The overrun record was not written for the approved baseline.',
      );
    }
    if (created.count === 1) {
      await this.audit.recordTenantMutation({
        entityType: 'WorkshopEstimateOverrun',
        entityId: row.id,
        action: AuditLogAction.CREATE,
        source: 'workshop-estimate-overrun',
        after: {
          workshop_estimate_version_id: baselineVersionId,
          detected_at: row.detected_at.toISOString(),
          approved_total_gross: warning.approved_total_gross,
          detected_total_gross: warning.current_total_gross,
          total_over_threshold: warning.total_over_threshold,
          new_work_lines: warning.new_work_lines,
        },
      });
    }
    return row;
  }
}
