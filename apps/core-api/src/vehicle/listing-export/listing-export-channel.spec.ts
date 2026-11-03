import { HttpException } from '@nestjs/common';
import {
  Prisma,
  VehicleListingDesiredState,
  VehicleListingVatDisplay,
} from '@prisma/client';
import {
  findDownloadableChannel,
  toOfferReadinessListing,
} from './listing-export-channel.js';
import { resolveListingSerializer } from './listing-serializer.registry.js';

const willhaben = resolveListingSerializer('WILLHABEN_GENERIC_V1');

function channel(overrides: Partial<{
  platform: string;
  serializer_profile: string;
  desired_state: VehicleListingDesiredState;
}> = {}) {
  return {
    platform: 'WILLHABEN',
    serializer_profile: 'WILLHABEN_GENERIC_V1',
    desired_state: VehicleListingDesiredState.ACTIVE,
    ...overrides,
  };
}

function errorCodeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as HttpException).getResponse() instanceof Object
      ? ((error as HttpException).getResponse() as { code: string }).code
      : '';
  }
  throw new Error('expected the channel lookup to throw');
}

describe('findDownloadableChannel', () => {
  it('returns the channel that matches the serializer platform', () => {
    const other = channel({ platform: 'MOBILE_DE', serializer_profile: 'MOBILE_DE_REFERENCE_V1' });
    const target = channel();

    expect(findDownloadableChannel([other, target], willhaben)).toBe(target);
  });

  it.each([
    ['no channel for the platform', [channel({ platform: 'MOBILE_DE' })], 'VEHICLE_LISTING_CHANNEL_NOT_FOUND'],
    ['a serializer profile that does not match the channel', [channel({ serializer_profile: 'OTHER_PROFILE' })], 'LISTING_SERIALIZER_PROFILE_MISMATCH'],
    ['a channel that is not ACTIVE', [channel({ desired_state: VehicleListingDesiredState.INACTIVE })], 'VEHICLE_LISTING_NOT_READY'],
  ])('refuses with a code when there is %s', (_case, channels, code) => {
    expect(errorCodeOf(() => findDownloadableChannel(channels, willhaben))).toBe(code);
  });
});

describe('toOfferReadinessListing', () => {
  it('keeps only the offer fields that readiness checks read', () => {
    const price = new Prisma.Decimal('12990.00');
    const listing = {
      price_gross_eur: price,
      vat_display: VehicleListingVatDisplay.MARGIN,
      nova_included_confirmed: false,
      mandatory_fees_included_confirmed: true,
      channels: [channel()],
      photos: [],
    };

    expect(toOfferReadinessListing(listing)).toEqual({
      price_gross_eur: price,
      vat_display: VehicleListingVatDisplay.MARGIN,
      nova_included_confirmed: false,
      mandatory_fees_included_confirmed: true,
    });
  });
});
