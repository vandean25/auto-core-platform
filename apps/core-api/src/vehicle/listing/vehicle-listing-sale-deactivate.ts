import {
  Prisma,
  VehicleListingDesiredState,
  VehicleListingExportState,
} from '@prisma/client';
import { findReceivedStockPurchaseIdForActiveSite } from '../equipment/vehicle-equipment-stock-cycle.js';

export type ListingChannelExportTransition = {
  export_state: VehicleListingExportState;
  bumpRemovalRevision: boolean;
};

/**
 * Maps a channel export_state when the vehicle leaves dealer stock (sale finalize).
 * Never-exported listings stay excluded without a removal row; previously exported
 * listings need REMOVAL_REQUIRED for the next portal feed.
 */
export function listingChannelExportStateOnSaleDeactivate(
  current: VehicleListingExportState,
): ListingChannelExportTransition {
  switch (current) {
    case VehicleListingExportState.NEVER_EXPORTED:
    case VehicleListingExportState.REMOVAL_ACKNOWLEDGED:
      return { export_state: current, bumpRemovalRevision: false };
    case VehicleListingExportState.FILE_GENERATED:
    case VehicleListingExportState.DIRTY:
      return {
        export_state: VehicleListingExportState.REMOVAL_REQUIRED,
        bumpRemovalRevision: true,
      };
    case VehicleListingExportState.REMOVAL_REQUIRED:
      return { export_state: current, bumpRemovalRevision: false };
    default: {
      const _exhaustive: never = current;
      return _exhaustive;
    }
  }
}

export type DeactivateVehicleListingsOnSaleInput = {
  tenantId: string;
  siteId: string;
  vehicleId: string;
  stockPurchaseId?: string | null;
};

/**
 * Marks marketplace listing channels inactive when dealer stock is released on sale.
 * Idempotent: repeated calls leave channels INACTIVE without re-bumping removal_revision.
 *
 * Reverting a finalized sale is not supported; listings stay inactive until a new stock cycle.
 */
export async function deactivateVehicleListingsOnSale(
  tx: Prisma.TransactionClient,
  input: DeactivateVehicleListingsOnSaleInput,
): Promise<void> {
  const stockPurchaseId =
    input.stockPurchaseId ??
    (await findReceivedStockPurchaseIdForActiveSite(
      tx,
      input.tenantId,
      input.vehicleId,
      input.siteId,
    ));

  if (!stockPurchaseId) {
    return;
  }

  const listing = await tx.vehicleListing.findFirst({
    where: {
      tenant_id: input.tenantId,
      vehicle_id: input.vehicleId,
      stock_purchase_id: stockPurchaseId,
    },
    include: { channels: true },
  });
  if (!listing) {
    return;
  }

  for (const channel of listing.channels) {
    const transition = listingChannelExportStateOnSaleDeactivate(
      channel.export_state,
    );
    const data: Prisma.VehicleListingChannelUpdateInput = {
      desired_state: VehicleListingDesiredState.INACTIVE,
      export_state: transition.export_state,
    };
    if (transition.bumpRemovalRevision) {
      data.removal_revision = { increment: 1 };
    }
    await tx.vehicleListingChannel.update({
      where: { tenant_id: input.tenantId, id: channel.id },
      data,
    });
  }
}
