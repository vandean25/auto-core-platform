import { ConflictException } from '@nestjs/common';
import { WorkshopEstimateStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import {
  calendarYearInVienna,
  generateWorkshopEstimateNumber,
} from './workshop-estimate-number.helpers.js';
import { loadOrderForWrite } from './workshop-estimate-order-access.js';
import type { EstimateScope } from './workshop-estimate-scope.js';

export async function createEstimateForOrderInTx(
  tx: Prisma.TransactionClient,
  scope: EstimateScope,
  orderId: string,
): Promise<string> {
  await loadOrderForWrite(tx, scope, orderId);
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
}
