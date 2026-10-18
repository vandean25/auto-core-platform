import type {
  Autoscout24DmsDeactivateResult,
  Autoscout24DmsListingPayload,
  Autoscout24DmsUpsertResult,
} from './autoscout24-dms-api.types.js';

export const AUTOSCOUT24_DMS_LISTING_PUBLISHER_PORT = Symbol(
  'AUTOSCOUT24_DMS_LISTING_PUBLISHER_PORT',
);

export interface Autoscout24DmsListingPublisherPort {
  upsertListing(
    idempotencyKey: string,
    payload: Autoscout24DmsListingPayload,
    existingExternalListingId: string | null,
  ): Promise<Autoscout24DmsUpsertResult>;

  deactivateListing(
    idempotencyKey: string,
    payload: Pick<Autoscout24DmsListingPayload, 'sellerListingRef'>,
    existingExternalListingId: string | null,
  ): Promise<Autoscout24DmsDeactivateResult>;
}
