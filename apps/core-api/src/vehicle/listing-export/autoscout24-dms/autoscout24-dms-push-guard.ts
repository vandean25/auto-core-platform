import { ServiceUnavailableException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { isVehicleListingAs24PushEnvEnabled } from './autoscout24-dms-env.js';

export async function assertVehicleListingAs24PushEnabled(
  prisma: Pick<PrismaClient, 'vehicleListingPushSettings'>,
  tenantId: string,
): Promise<void> {
  if (!isVehicleListingAs24PushEnvEnabled()) {
    throw new ServiceUnavailableException({
      code: 'LISTING_PUSH_DISABLED',
      message: 'AutoScout24 DMS API push is disabled for this deployment.',
    });
  }

  const settings = await prisma.vehicleListingPushSettings.findFirst({
    where: { tenant_id: tenantId },
    select: { as24_dms_push_enabled: true },
  });

  if (!settings?.as24_dms_push_enabled) {
    throw new ServiceUnavailableException({
      code: 'LISTING_PUSH_DISABLED',
      message: 'AutoScout24 DMS API push is not enabled for this tenant.',
    });
  }
}
