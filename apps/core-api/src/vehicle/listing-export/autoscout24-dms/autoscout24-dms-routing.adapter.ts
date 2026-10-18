import { Injectable } from '@nestjs/common';
import type { Autoscout24DmsListingPublisherPort } from './autoscout24-dms-api.port.js';
import type {
  Autoscout24DmsDeactivateResult,
  Autoscout24DmsListingPayload,
  Autoscout24DmsUpsertResult,
} from './autoscout24-dms-api.types.js';
import {
  isAutoscout24DmsHttpConfigured,
  useAutoscout24DmsFakeAdapterInProcess,
} from './autoscout24-dms-env.js';
import { FakeAutoscout24DmsListingPublisherAdapter } from './autoscout24-dms-fake.adapter.js';
import { HttpAutoscout24DmsListingPublisherAdapter } from './autoscout24-dms-http.adapter.js';
import { NotConfiguredAutoscout24DmsListingPublisherAdapter } from './autoscout24-dms-not-configured.adapter.js';

@Injectable()
export class RoutingAutoscout24DmsListingPublisherAdapter implements Autoscout24DmsListingPublisherPort {
  constructor(
    private readonly fakeAdapter: FakeAutoscout24DmsListingPublisherAdapter,
    private readonly httpAdapter: HttpAutoscout24DmsListingPublisherAdapter,
    private readonly notConfiguredAdapter: NotConfiguredAutoscout24DmsListingPublisherAdapter,
  ) {}

  private resolveDelegate(): Autoscout24DmsListingPublisherPort {
    if (useAutoscout24DmsFakeAdapterInProcess()) {
      return this.fakeAdapter;
    }
    if (isAutoscout24DmsHttpConfigured()) {
      return this.httpAdapter;
    }
    return this.notConfiguredAdapter;
  }

  upsertListing(
    idempotencyKey: string,
    payload: Autoscout24DmsListingPayload,
    existingExternalListingId: string | null,
  ): Promise<Autoscout24DmsUpsertResult> {
    return this.resolveDelegate().upsertListing(
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
    return this.resolveDelegate().deactivateListing(
      idempotencyKey,
      payload,
      existingExternalListingId,
    );
  }
}
