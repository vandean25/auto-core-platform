import { Logger } from '@nestjs/common';
import {
  AuditActorType,
  AuditLogAction,
  Prisma,
  WorkshopEstimateStatus,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { WorkshopEstimateOverrunWarning } from './workshop-estimate-overrun.helpers.js';
import { computeWorkshopEstimateOverrun } from './workshop-estimate-overrun.helpers.js';
import {
  buildWorkshopEstimateLines,
  collectEstimateSourceLines,
} from './workshop-estimate-lines.helpers.js';
import type { WorkshopEstimateSnapshot } from './workshop-estimate-snapshot.js';

const logger = new Logger('WorkshopEstimateOverrunSync');
const DEFAULT_OVERRUN_THRESHOLD_PCT = '15';

const ORDER_LINES_SELECT = {
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

/**
 * Records an overrun as soon as a write changes the estimate lines of an order (AUT-355, ADR-0025 §1). The first
 * detection time is then the time the total went over, not the time someone next read the estimate.
 *
 * Best effort: the write has already committed, and every estimate read still detects the overrun. A failure here is
 * logged and never fails the caller's request.
 */
export async function syncWorkshopEstimateOverrunAfterWrite(
  prisma: PrismaService,
  tenantId: string,
  workshopOrderId: string,
): Promise<void> {
  try {
    await detectOverrunForOrder(prisma, tenantId, workshopOrderId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn(
      `Overrun check skipped for order ${workshopOrderId} after a line change: ${reason}`,
    );
  }
}

async function detectOverrunForOrder(
  prisma: PrismaService,
  tenantId: string,
  workshopOrderId: string,
): Promise<void> {
  const baseline = await prisma.workshopEstimateVersion.findFirst({
    where: {
      tenant_id: tenantId,
      status: WorkshopEstimateStatus.APPROVED,
      estimate: { workshop_order_id: workshopOrderId },
    },
    orderBy: { version: 'desc' },
    select: { id: true, snapshot: true },
  });
  if (!baseline?.snapshot) {
    return;
  }
  const order = await prisma.workshopOrder.findFirst({
    where: { id: workshopOrderId, tenant_id: tenantId },
    select: ORDER_LINES_SELECT,
  });
  if (!order) {
    return;
  }
  const settings = await prisma.financeSettings.findFirst({
    where: { tenant_id: tenantId },
    select: { estimate_overrun_threshold_pct: true },
  });
  const snapshot = baseline.snapshot as unknown as WorkshopEstimateSnapshot;
  const warning = computeWorkshopEstimateOverrun({
    approved: {
      total_gross: snapshot.totals.total_gross,
      lines: snapshot.lines,
    },
    currentLines: buildWorkshopEstimateLines(
      collectEstimateSourceLines(order.tasks),
    ),
    thresholdPct:
      settings?.estimate_overrun_threshold_pct.toFixed(2) ??
      DEFAULT_OVERRUN_THRESHOLD_PCT,
  });
  if (warning) {
    await recordFirstDetection(prisma, tenantId, baseline.id, warning);
  }
}

/**
 * Writes the overrun record of an approved baseline the first time it is seen, with its audit row, in one
 * transaction. A second call for the same baseline writes nothing. The audit row is written as the system,
 * since detection follows a change or a read rather than a single advisor action.
 */
export async function recordFirstDetection(
  prisma: PrismaService,
  tenantId: string,
  baselineVersionId: string,
  warning: WorkshopEstimateOverrunWarning,
): Promise<void> {
  const detectedAt = new Date();
  await prisma.$transaction(async (tx) => {
    const created = await tx.workshopEstimateOverrun.createMany({
      data: [
        {
          tenant_id: tenantId,
          workshop_estimate_version_id: baselineVersionId,
          detected_at: detectedAt,
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
    if (created.count !== 1) {
      return;
    }
    const row = await tx.workshopEstimateOverrun.findFirst({
      where: {
        tenant_id: tenantId,
        workshop_estimate_version_id: baselineVersionId,
      },
      select: { id: true },
    });
    if (!row) {
      throw new Error(
        'The overrun record was not readable after it was written.',
      );
    }
    await tx.auditLog.create({
      data: {
        tenant_id: tenantId,
        entity_type: 'WorkshopEstimateOverrun',
        entity_id: row.id,
        action: AuditLogAction.CREATE,
        actor_type: AuditActorType.SYSTEM,
        source: 'workshop-estimate-overrun',
        after: {
          workshop_estimate_version_id: baselineVersionId,
          detected_at: detectedAt.toISOString(),
          approved_total_gross: warning.approved_total_gross,
          detected_total_gross: warning.current_total_gross,
          total_over_threshold: warning.total_over_threshold,
          new_work_lines: warning.new_work_lines,
        },
      },
    });
  });
}
