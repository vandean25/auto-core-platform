import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  VehicleListingDesiredState,
  type VehicleListing,
} from '@prisma/client';
import type { ListingSerializerPort } from './listing-serializer.types.js';

type ExportChannelRow = {
  platform: string;
  serializer_profile: string;
  desired_state: VehicleListingDesiredState;
};

type OfferReadinessKey =
  | 'price_gross_eur'
  | 'vat_display'
  | 'nova_included_confirmed'
  | 'mandatory_fees_included_confirmed';

/** Offer fields that the listing readiness checks read. */
export function toOfferReadinessListing<
  L extends Pick<VehicleListing, OfferReadinessKey>,
>(listing: L): Pick<L, OfferReadinessKey> {
  return {
    price_gross_eur: listing.price_gross_eur,
    vat_display: listing.vat_display,
    nova_included_confirmed: listing.nova_included_confirmed,
    mandatory_fees_included_confirmed:
      listing.mandatory_fees_included_confirmed,
  };
}

/**
 * Picks the channel a package is downloaded for. Refuses when the channel is
 * missing, does not match the serializer, or is not ACTIVE.
 */
export function findDownloadableChannel<T extends ExportChannelRow>(
  channels: T[],
  serializer: ListingSerializerPort,
): T {
  const channel = channels.find((row) => row.platform === serializer.platform);
  if (!channel) {
    throw new NotFoundException({
      code: 'VEHICLE_LISTING_CHANNEL_NOT_FOUND',
      message: `No listing channel exists for ${serializer.platform}.`,
    });
  }
  if (channel.serializer_profile !== serializer.profileCode) {
    throw new UnprocessableEntityException({
      code: 'LISTING_SERIALIZER_PROFILE_MISMATCH',
      message: `Channel profile ${channel.serializer_profile} does not match ${serializer.profileCode}.`,
    });
  }
  if (channel.desired_state !== VehicleListingDesiredState.ACTIVE) {
    throw new UnprocessableEntityException({
      code: 'VEHICLE_LISTING_NOT_READY',
      message:
        'Listing channel must be ACTIVE before downloading an export package.',
    });
  }
  return channel;
}
