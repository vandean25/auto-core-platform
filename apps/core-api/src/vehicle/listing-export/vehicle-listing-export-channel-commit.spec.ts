import { UnprocessableEntityException } from '@nestjs/common';
import { VehicleListingDesiredState } from '@prisma/client';
import { commitListingChannelGeneratedExport } from './vehicle-listing-export-channel-commit.js';

describe('commitListingChannelGeneratedExport', () => {
  const tenantId = 'tenant-1';
  const channelId = 'channel-1';
  const generatedAt = new Date('2026-10-17T12:00:00.000Z');
  const contentSha256 = 'a'.repeat(64);

  it('updates export metadata when the channel is still ACTIVE', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = { vehicleListingChannel: { updateMany } };

    await commitListingChannelGeneratedExport(tx, {
      tenantId,
      channelId,
      generatedAt,
      contentSha256,
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        tenant_id: tenantId,
        id: channelId,
        desired_state: VehicleListingDesiredState.ACTIVE,
      },
      data: expect.objectContaining({
        last_export_content_sha256: contentSha256,
      }),
    });
  });

  it('refuses to downgrade when sale deactivated the channel concurrently', async () => {
    const tx = {
      vehicleListingChannel: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const error = await commitListingChannelGeneratedExport(tx, {
      tenantId,
      channelId,
      generatedAt,
      contentSha256,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(error).toMatchObject({
      response: { code: 'VEHICLE_LISTING_NOT_READY' },
    });
  });
});
