import { WorkshopEstimateStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';

export function isDueForExpiry(
  version: { status: WorkshopEstimateStatus; valid_until: Date | null },
  now: Date,
): boolean {
  return (
    version.status === WorkshopEstimateStatus.SENT &&
    version.valid_until !== null &&
    version.valid_until.getTime() < now.getTime()
  );
}

export async function expireDueEstimateVersions(
  prisma: PrismaService,
  tenantId: string,
  estimateId: string,
  now: Date,
): Promise<void> {
  await prisma.workshopEstimateVersion.updateMany({
    where: {
      tenant_id: tenantId,
      estimate_id: estimateId,
      status: WorkshopEstimateStatus.SENT,
      valid_until: { lt: now },
    },
    data: { status: WorkshopEstimateStatus.EXPIRED },
  });
}
