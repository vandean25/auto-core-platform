import type { PrismaService } from '../prisma/prisma.service.js';
import type { WorkshopEstimateListResponseDto } from './dto/workshop-estimate-response.dto.js';
import { findOrderInScope } from './workshop-estimate-order-access.js';
import { readWorkshopEstimate } from './workshop-estimate-read.js';
import type { EstimateScope } from './workshop-estimate-scope.js';
import type { WorkshopEstimateOverrunService } from './workshop-estimate-overrun.service.js';

export async function listEstimatesForOrder(
  prisma: PrismaService,
  overruns: WorkshopEstimateOverrunService,
  scope: EstimateScope,
  orderId: string,
): Promise<WorkshopEstimateListResponseDto> {
  await findOrderInScope(prisma, scope, orderId);
  const estimate = await prisma.workshopEstimate.findFirst({
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
  return {
    data: [await readWorkshopEstimate(prisma, overruns, scope, estimate.id)],
  };
}
