import type { Prisma, VehicleListingDmsProvider } from '@prisma/client';

export async function lockVehicleListingChannelDmsSyncRow(
  tx: Prisma.TransactionClient,
  tenantId: string,
  syncId: string,
): Promise<void> {
  // eslint-disable-next-line no-restricted-syntax -- tenant-qualified DMS sync row lock for push serialization.
  await tx.$queryRaw`
    SELECT id
    FROM vehicle_listing_channel_dms_syncs
    WHERE tenant_id = ${tenantId}
      AND id = ${syncId}
    FOR UPDATE
  `;
}

export async function ensureDmsSyncRow(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    channelId: string;
    provider: VehicleListingDmsProvider;
  },
): Promise<{ id: string }> {
  return tx.vehicleListingChannelDmsSync.upsert({
    where: {
      tenant_id_channel_id_provider: {
        tenant_id: input.tenantId,
        channel_id: input.channelId,
        provider: input.provider,
      },
    },
    create: {
      tenant_id: input.tenantId,
      channel_id: input.channelId,
      provider: input.provider,
    },
    update: {},
    select: { id: true },
  });
}
