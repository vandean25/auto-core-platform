import { ConflictException, NotFoundException } from '@nestjs/common';
import { WorkshopEstimateStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { loadOrderForWrite } from './workshop-estimate-order-access.js';
import type { EstimateScope } from './workshop-estimate-scope.js';

export async function createEstimateRevisionInTx(
  tx: Prisma.TransactionClient,
  scope: EstimateScope,
  orderId: string,
): Promise<string> {
  await loadOrderForWrite(tx, scope, orderId);
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
}
