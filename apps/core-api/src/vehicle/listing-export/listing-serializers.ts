import type { ListingSerializerPort } from './listing-serializer.types.js';
import { autoscout24ProvisionalListingSerializer } from './autoscout24-provisional.serializer.js';
import { mobileDeReferenceListingSerializer } from './mobile-de-reference.serializer.js';
import { willhabenGenericListingSerializer } from './willhaben-generic.serializer.js';

/** Every listing export serializer. The registry indexes them by profile code. */
export const listingSerializers: readonly ListingSerializerPort[] = [
  mobileDeReferenceListingSerializer,
  autoscout24ProvisionalListingSerializer,
  willhabenGenericListingSerializer,
];
