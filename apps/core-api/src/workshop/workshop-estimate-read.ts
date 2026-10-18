import { NotFoundException } from '@nestjs/common';
import { WorkshopEstimateStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type {
  WorkshopEstimateDraftPreviewDto,
  WorkshopEstimateResponseDto,
  WorkshopEstimateVersionDetailDto,
} from './dto/workshop-estimate-response.dto.js';
import { isCustomerEstimateSendEnabled } from './workshop-estimate.constants.js';
import {
  buildWorkshopEstimateLines,
  buildWorkshopEstimateTotals,
  collectEstimateCustomerSendBlockers,
  collectEstimateSourceLines,
} from './workshop-estimate-lines.helpers.js';
import {
  computeWorkshopEstimateOverrun,
  type WorkshopEstimateOverrunWarning,
} from './workshop-estimate-overrun.helpers.js';
import type { WorkshopEstimateOverrunService } from './workshop-estimate-overrun.service.js';
import { findOrderInScope } from './workshop-estimate-order-access.js';
import type { EstimateScope } from './workshop-estimate-scope.js';
import {
  WORKSHOP_ESTIMATE_VERSION_SUMMARY_SELECT,
  toWorkshopEstimateDto,
  toWorkshopEstimateDraftPreviewDto,
  toWorkshopEstimateVersionDetailDto,
} from './workshop-estimate-response.mapper.js';
import type { WorkshopEstimateSnapshot } from './workshop-estimate-snapshot.js';
import {
  expireDueEstimateVersions,
  isDueForExpiry,
} from './workshop-estimate-version-expiry.js';

const DEFAULT_OVERRUN_THRESHOLD_PCT = '15';

export async function readWorkshopEstimate(
  prisma: PrismaService,
  overruns: WorkshopEstimateOverrunService,
  scope: EstimateScope,
  estimateId: string,
): Promise<WorkshopEstimateResponseDto> {
  const now = new Date();
  await expireDueEstimateVersions(prisma, scope.tenantId, estimateId, now);

  const estimate = await prisma.workshopEstimate.findFirst({
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
    findOrderInScope(prisma, scope, estimate.workshop_order_id),
    prisma.workshopEstimateVersion.findFirst({
      where: {
        tenant_id: scope.tenantId,
        estimate_id: estimateId,
        status: WorkshopEstimateStatus.APPROVED,
      },
      orderBy: { version: 'desc' },
      select: { id: true, snapshot: true },
    }),
    prisma.financeSettings.findFirst({
      where: { tenant_id: scope.tenantId },
      select: { estimate_overrun_threshold_pct: true },
    }),
  ]);

  const thresholdPct =
    settings?.estimate_overrun_threshold_pct.toFixed(2) ??
    DEFAULT_OVERRUN_THRESHOLD_PCT;
  const approvedSnapshot = approved?.snapshot as unknown as
    | WorkshopEstimateSnapshot
    | null
    | undefined;
  const warning: WorkshopEstimateOverrunWarning | null = approvedSnapshot
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
  const overrun =
    approved && warning
      ? await overruns.observe(scope.tenantId, approved.id, warning)
      : null;

  const customerSendBlockers = collectEstimateCustomerSendBlockers(
    collectEstimateSourceLines(order.tasks),
  );

  return toWorkshopEstimateDto({
    estimate,
    overrun,
    sendEnabled: isCustomerEstimateSendEnabled(),
    thresholdPct,
    customerSendBlockers,
  });
}

export async function readWorkshopEstimateVersion(
  prisma: PrismaService,
  scope: EstimateScope,
  versionId: string,
): Promise<WorkshopEstimateVersionDetailDto> {
  const version = await prisma.workshopEstimateVersion.findFirst({
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
  await expireDueEstimateVersions(prisma, scope.tenantId, version.estimate_id, now);
  const status = isDueForExpiry(version, now)
    ? WorkshopEstimateStatus.EXPIRED
    : version.status;

  let draftPreview: WorkshopEstimateDraftPreviewDto | null = null;
  if (version.status === WorkshopEstimateStatus.DRAFT) {
    const order = await findOrderInScope(
      prisma,
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
