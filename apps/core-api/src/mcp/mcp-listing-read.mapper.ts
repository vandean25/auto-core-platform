import type { VehicleListing, VehicleListingChannel } from '@prisma/client';

export type VehicleListingWithChannels = VehicleListing & {
  channels: VehicleListingChannel[];
};

export function toMcpVehicleListingRow(listing: VehicleListingWithChannels) {
  return {
    listing_id: listing.id,
    listing_ref: listing.listing_ref,
    stock_purchase_id: listing.stock_purchase_id,
    site_id: listing.site_id,
    revision: listing.revision,
    channels: listing.channels.map((channel) => ({
      platform: channel.platform,
      desired_state: channel.desired_state,
      export_state: channel.export_state,
      remote_state: channel.remote_state,
      serializer_profile: channel.serializer_profile,
      last_export_at: channel.last_export_at?.toISOString() ?? null,
      removal_revision: channel.removal_revision,
    })),
  };
}

export function toMcpVehicleListingStatus(
  vehicleId: string,
  listings: VehicleListingWithChannels[],
) {
  return {
    vehicle_id: vehicleId,
    listings: listings.map(toMcpVehicleListingRow),
  };
}
