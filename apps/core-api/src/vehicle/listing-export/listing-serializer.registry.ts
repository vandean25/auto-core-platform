import { UnprocessableEntityException } from '@nestjs/common';
import { listingSerializers } from './listing-serializers.js';
import type { ListingSerializerPort } from './listing-serializer.types.js';

const serializersByProfileCode = new Map(
  listingSerializers.map((serializer): [string, ListingSerializerPort] => [
    serializer.profileCode,
    serializer,
  ]),
);

export function resolveListingSerializer(
  profileCode: string | null | undefined,
): ListingSerializerPort {
  if (!profileCode?.trim()) {
    throw new UnprocessableEntityException({
      code: 'LISTING_SERIALIZER_PROFILE_MISSING',
      message: 'Listing serializer profile code is required.',
    });
  }

  const serializer = serializersByProfileCode.get(profileCode.trim());
  if (!serializer) {
    throw new UnprocessableEntityException({
      code: 'LISTING_SERIALIZER_UNSUPPORTED',
      message: `No listing export serializer is registered for ${profileCode}.`,
    });
  }

  return serializer;
}
