import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Autoscout24DmsListingPublisherPort } from './autoscout24-dms-api.port.js';
import type {
  Autoscout24DmsDeactivateResult,
  Autoscout24DmsListingPayload,
  Autoscout24DmsUpsertResult,
} from './autoscout24-dms-api.types.js';

@Injectable()
export class NotConfiguredAutoscout24DmsListingPublisherAdapter implements Autoscout24DmsListingPublisherPort {
  private refuse(): never {
    throw new ServiceUnavailableException({
      code: 'LISTING_PUSH_UNCONFIGURED',
      message:
        'AutoScout24 DMS API push is enabled but no live adapter is configured for this deployment.',
    });
  }

  upsertListing(
    _idempotencyKey: string,
    _payload: Autoscout24DmsListingPayload,
    _existingExternalListingId: string | null,
  ): Promise<Autoscout24DmsUpsertResult> {
    return Promise.resolve(this.refuse());
  }

  deactivateListing(
    _idempotencyKey: string,
    _payload: Pick<Autoscout24DmsListingPayload, 'sellerListingRef'>,
    _existingExternalListingId: string | null,
  ): Promise<Autoscout24DmsDeactivateResult> {
    return Promise.resolve(this.refuse());
  }
}
