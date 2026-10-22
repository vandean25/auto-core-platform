import { UnprocessableEntityException } from '@nestjs/common';
import {
  VehicleListingDesiredState,
  VehicleListingExportState,
  type Prisma,
} from '@prisma/client';

type ChannelCommitClient = {
  vehicleListingChannel: Pick<
    Prisma.TransactionClient['vehicleListingChannel'],
    'updateMany'
  >;
};

export async function commitListingChannelGeneratedExport(
  tx: ChannelCommitClient,
  input: {
    tenantId: string;
    channelId: string;
    generatedAt: Date;
    contentSha256: string;
  },
): Promise<void> {
  const updated = await tx.vehicleListingChannel.updateMany({
    where: {
      tenant_id: input.tenantId,
      id: input.channelId,
      desired_state: VehicleListingDesiredState.ACTIVE,
    },
    data: {
      export_state: VehicleListingExportState.FILE_GENERATED,
      last_export_at: input.generatedAt,
      last_export_content_sha256: input.contentSha256,
    },
  });

  if (updated.count !== 1) {
    throw new UnprocessableEntityException({
      code: 'VEHICLE_LISTING_NOT_READY',
      message:
        'Listing channel must be ACTIVE before downloading an export package.',
    });
  }
}
