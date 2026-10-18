import { Injectable } from '@nestjs/common';
import type { Autoscout24DmsListingPublisherPort } from './autoscout24-dms-api.port.js';
import type {
  Autoscout24DmsDeactivateResult,
  Autoscout24DmsListingPayload,
  Autoscout24DmsUpsertResult,
} from './autoscout24-dms-api.types.js';
import { FakeAutoscout24DmsContractServer } from './autoscout24-dms-contract.server.js';

@Injectable()
export class FakeAutoscout24DmsListingPublisherAdapter implements Autoscout24DmsListingPublisherPort {
  readonly contract = new FakeAutoscout24DmsContractServer();

  upsertListing(
    idempotencyKey: string,
    payload: Autoscout24DmsListingPayload,
    existingExternalListingId: string | null,
  ): Promise<Autoscout24DmsUpsertResult> {
    return this.contract.upsertListing(
      idempotencyKey,
      payload,
      existingExternalListingId,
    );
  }

  deactivateListing(
    idempotencyKey: string,
    payload: Pick<Autoscout24DmsListingPayload, 'sellerListingRef'>,
    existingExternalListingId: string | null,
  ): Promise<Autoscout24DmsDeactivateResult> {
    return this.contract.deactivateListing(
      idempotencyKey,
      payload.sellerListingRef,
      existingExternalListingId,
    );
  }
}
