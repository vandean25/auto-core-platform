import {
  VehicleListingDesiredState,
  VehicleListingExportState,
  VehicleListingPlatform,
} from '@prisma/client';
import {
  deactivateVehicleListingsOnSale,
  listingChannelExportStateOnSaleDeactivate,
} from './vehicle-listing-sale-deactivate.js';

describe('listingChannelExportStateOnSaleDeactivate', () => {
  it('keeps NEVER_EXPORTED so the listing stays out of the feed without a delete row', () => {
    expect(
      listingChannelExportStateOnSaleDeactivate(
        VehicleListingExportState.NEVER_EXPORTED,
      ),
    ).toEqual({
      export_state: VehicleListingExportState.NEVER_EXPORTED,
      bumpRemovalRevision: false,
    });
  });

  it('requires removal after a file was generated', () => {
    expect(
      listingChannelExportStateOnSaleDeactivate(
        VehicleListingExportState.FILE_GENERATED,
      ),
    ).toEqual({
      export_state: VehicleListingExportState.REMOVAL_REQUIRED,
      bumpRemovalRevision: true,
    });
  });

  it('is idempotent when removal is already required', () => {
    expect(
      listingChannelExportStateOnSaleDeactivate(
        VehicleListingExportState.REMOVAL_REQUIRED,
      ),
    ).toEqual({
      export_state: VehicleListingExportState.REMOVAL_REQUIRED,
      bumpRemovalRevision: false,
    });
  });
});

describe('deactivateVehicleListingsOnSale', () => {
  const tenantId = 'tenant-1';
  const siteId = 'site-1';
  const vehicleId = 'vehicle-1';
  const stockPurchaseId = 'purchase-1';
  const listingId = 'listing-1';

  const makeTx = (channels: {
    id: string;
    export_state: VehicleListingExportState;
    desired_state?: VehicleListingDesiredState;
  }[]) => {
    const channelUpdates: unknown[] = [];
    return {
      channelUpdates,
      vehiclePurchase: {
        findFirst: jest.fn().mockResolvedValue({ id: stockPurchaseId }),
      },
      vehicleListing: {
        findFirst: jest.fn().mockResolvedValue({
          id: listingId,
          channels: channels.map((row) => ({
            id: row.id,
            platform: VehicleListingPlatform.MOBILE_DE,
            desired_state:
              row.desired_state ?? VehicleListingDesiredState.ACTIVE,
            export_state: row.export_state,
          })),
        }),
      },
      vehicleListingChannel: {
        update: jest.fn().mockImplementation(async ({ data }) => {
          channelUpdates.push(data);
          return {};
        }),
      },
    };
  };

  it('sets channels inactive and flags REMOVAL_REQUIRED after export', async () => {
    const tx = makeTx([
      { id: 'ch-1', export_state: VehicleListingExportState.FILE_GENERATED },
    ]);
    await deactivateVehicleListingsOnSale(tx as never, {
      tenantId,
      siteId,
      vehicleId,
      stockPurchaseId,
    });
    expect(tx.vehicleListingChannel.update).toHaveBeenCalledWith({
      where: { tenant_id: tenantId, id: 'ch-1' },
      data: {
        desired_state: VehicleListingDesiredState.INACTIVE,
        export_state: VehicleListingExportState.REMOVAL_REQUIRED,
        removal_revision: { increment: 1 },
      },
    });
  });

  it('does not bump removal_revision on a second deactivate call', async () => {
    const tx = makeTx([
      {
        id: 'ch-1',
        export_state: VehicleListingExportState.REMOVAL_REQUIRED,
        desired_state: VehicleListingDesiredState.INACTIVE,
      },
    ]);
    await deactivateVehicleListingsOnSale(tx as never, {
      tenantId,
      siteId,
      vehicleId,
      stockPurchaseId,
    });
    expect(tx.vehicleListingChannel.update).toHaveBeenCalledWith({
      where: { tenant_id: tenantId, id: 'ch-1' },
      data: {
        desired_state: VehicleListingDesiredState.INACTIVE,
        export_state: VehicleListingExportState.REMOVAL_REQUIRED,
      },
    });
  });

  it('skips work when no listing exists for the stock cycle', async () => {
    const tx = makeTx([]);
    tx.vehicleListing.findFirst.mockResolvedValue(null);
    await deactivateVehicleListingsOnSale(tx as never, {
      tenantId,
      siteId,
      vehicleId,
      stockPurchaseId,
    });
    expect(tx.vehicleListingChannel.update).not.toHaveBeenCalled();
  });
});
