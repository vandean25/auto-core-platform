import type {
  VehicleListing,
  VehicleListingChannel,
  VehicleListingPhoto,
  VehicleMedia,
} from '@prisma/client';
import type {
  VehicleListingChannelDto,
  VehicleListingDto,
  VehicleListingPhotoDto,
  VehicleListingPriceDisplayDto,
} from './dto/vehicle-listing.dto.js';
import { buildVehicleListingPriceDisplay } from './vehicle-listing-price-display.js';

type ListingWithRelations = VehicleListing & {
  photos: (VehicleListingPhoto & { media: VehicleMedia })[];
  channels: VehicleListingChannel[];
};

export function toVehicleListingPriceDisplayDto(
  listing: VehicleListing,
): VehicleListingPriceDisplayDto {
  return buildVehicleListingPriceDisplay({
    price_gross_eur: listing.price_gross_eur,
    vat_display: listing.vat_display,
    nova_included_confirmed: listing.nova_included_confirmed,
    mandatory_fees_included_confirmed: listing.mandatory_fees_included_confirmed,
  });
}

function toPhotoDto(
  row: VehicleListingPhoto & { media: VehicleMedia },
): VehicleListingPhotoDto {
  return {
    media_id: row.media_id,
    sort_order: row.sort_order,
    content_sha256: row.media.content_sha256,
  };
}

function toChannelDto(row: VehicleListingChannel): VehicleListingChannelDto {
  return {
    id: row.id,
    platform: row.platform,
    serializer_profile: row.serializer_profile,
    mapping_version: row.mapping_version,
    desired_state: row.desired_state,
    export_state: row.export_state,
    remote_state: row.remote_state,
    last_export_at: row.last_export_at?.toISOString() ?? null,
    last_export_content_sha256: row.last_export_content_sha256,
    external_ref: row.external_ref,
  };
}

export function toVehicleListingDto(
  listing: ListingWithRelations,
): VehicleListingDto {
  return {
    id: listing.id,
    site_id: listing.site_id,
    vehicle_id: listing.vehicle_id,
    stock_purchase_id: listing.stock_purchase_id,
    listing_ref: listing.listing_ref,
    revision: listing.revision,
    title: listing.title,
    description: listing.description,
    description_language: listing.description_language,
    price_display: toVehicleListingPriceDisplayDto(listing),
    equipment_free_text: listing.equipment_free_text,
    content_sha256: listing.content_sha256,
    photos: listing.photos
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(toPhotoDto),
    channels: listing.channels
      .slice()
      .sort((a, b) => a.platform.localeCompare(b.platform))
      .map(toChannelDto),
  };
}
