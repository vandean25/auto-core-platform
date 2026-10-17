import { VehicleListingExportState, type Prisma } from '@prisma/client';
import { findReceivedStockPurchaseIdForActiveSite } from '../equipment/vehicle-equipment-stock-cycle.js';
import {
  computeListingContentSha256FromDb,
  photoMediaIdsForListing,
  type ListingWithHashRelations,
} from './vehicle-listing-content-hash.builder.js';

const listingInclude = {
  photos: { include: { media: true }, orderBy: { sort_order: 'asc' } },
  channels: true,
} satisfies Prisma.VehicleListingInclude;

type SyncClient = Pick<
  Prisma.TransactionClient,
  | 'vehicleListing'
  | 'vehicleListingChannel'
  | 'vehicleEquipmentSelection'
  | 'vehicleEquipmentFreeTextItem'
  | 'vehicleMedia'
  | 'vehicle'
  | 'vehiclePurchase'
>;

export async function syncVehicleListingContentHashWhenStockCycleExists(
  prisma: SyncClient,
  params: {
    tenantId: string;
    siteId: string;
    vehicleId: string;
  },
): Promise<boolean> {
  const stockPurchaseId = await findReceivedStockPurchaseIdForActiveSite(
    prisma,
    params.tenantId,
    params.vehicleId,
    params.siteId,
  );
  if (!stockPurchaseId) {
    return false;
  }
  return syncVehicleListingContentHash(prisma, {
    ...params,
    stockPurchaseId,
  });
}

export async function syncVehicleListingContentHash(
  prisma: SyncClient,
  params: {
    tenantId: string;
    siteId: string;
    vehicleId: string;
    stockPurchaseId: string;
  },
): Promise<boolean> {
  const listing = await prisma.vehicleListing.findFirst({
    where: {
      tenant_id: params.tenantId,
      vehicle_id: params.vehicleId,
      stock_purchase_id: params.stockPurchaseId,
      site_id: params.siteId,
    },
    include: listingInclude,
  });

  if (!listing) {
    return false;
  }

  return applyListingContentHashUpdate(prisma, listing);
}

export async function applyListingContentHashUpdate(
  prisma: SyncClient,
  listing: ListingWithHashRelations,
): Promise<boolean> {
  const nextHash = await computeListingContentSha256FromDb(prisma, {
    tenantId: listing.tenant_id,
    siteId: listing.site_id,
    vehicleId: listing.vehicle_id,
    stockPurchaseId: listing.stock_purchase_id,
    listingRef: listing.listing_ref,
    listing,
    photoMediaIds: photoMediaIdsForListing(listing),
    channels: listing.channels,
  });

  if (nextHash === listing.content_sha256) {
    return false;
  }

  const guarded = await prisma.vehicleListing.updateMany({
    where: {
      tenant_id: listing.tenant_id,
      id: listing.id,
      revision: listing.revision,
    },
    data: {
      content_sha256: nextHash,
      revision: { increment: 1 },
    },
  });
  if (guarded.count !== 1) {
    return false;
  }

  await prisma.vehicleListingChannel.updateMany({
    where: {
      tenant_id: listing.tenant_id,
      listing_id: listing.id,
      export_state: VehicleListingExportState.FILE_GENERATED,
    },
    data: { export_state: VehicleListingExportState.DIRTY },
  });

  return true;
}
