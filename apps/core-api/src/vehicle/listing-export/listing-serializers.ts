import type { ListingSerializerPort } from './listing-serializer.types.js';
import { mobileDeReferenceListingSerializer } from './mobile-de-reference.serializer.js';

/** Every listing export serializer. The registry indexes them by profile code. */
export const listingSerializers: readonly ListingSerializerPort[] = [
  mobileDeReferenceListingSerializer,
];
