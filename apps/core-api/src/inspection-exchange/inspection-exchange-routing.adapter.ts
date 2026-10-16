import { Injectable } from '@nestjs/common';
import { FakeEbvDmsResultReadAdapter } from './inspection-exchange-fake.adapter.js';
import { NotConfiguredEbvDmsResultReadAdapter } from './inspection-exchange-not-configured.adapter.js';
import type { EbvDmsResultReadPort } from './inspection-exchange.port.js';
import type {
  EbvFetchEnvelope,
  InspectionConnectionContext,
} from './inspection-exchange.types.js';

@Injectable()
export class RoutingEbvDmsResultReadAdapter implements EbvDmsResultReadPort {
  constructor(
    private readonly fakeAdapter: FakeEbvDmsResultReadAdapter,
    private readonly nativeAdapter: NotConfiguredEbvDmsResultReadAdapter,
  ) {}

  fetchResult(
    connection: InspectionConnectionContext,
    nativeResultReference: string,
  ): Promise<EbvFetchEnvelope> {
    if (connection.profileId === 'TEST_ONLY') {
      return this.fakeAdapter.fetchResult(connection, nativeResultReference);
    }
    return this.nativeAdapter.fetchResult(connection, nativeResultReference);
  }
}
