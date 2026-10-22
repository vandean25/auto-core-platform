import { ServiceUnavailableException } from '@nestjs/common';
import { isVehicleListingAs24PushEnvEnabled } from './autoscout24-dms-env.js';

type PushSettingsReader = {
  vehicleListingPushSettings: {
    findFirst(args: {
      where: { tenant_id: string };
      select: { as24_dms_push_enabled: true };
    }): PromiseLike<{ as24_dms_push_enabled: boolean } | null>;
  };
};

export async function assertVehicleListingAs24PushEnabled(
  prisma: PushSettingsReader,
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
