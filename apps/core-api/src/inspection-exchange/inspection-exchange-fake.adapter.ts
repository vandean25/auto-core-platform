import { Injectable } from '@nestjs/common';
import type { EbvDmsResultReadPort } from './inspection-exchange.port.js';
import type {
  EbvFetchEnvelope,
  InspectionConnectionContext,
} from './inspection-exchange.types.js';
import { lookupSyntheticCanonicalResult } from './inspection-exchange-synthetic-fixtures.js';

@Injectable()
export class FakeEbvDmsResultReadAdapter implements EbvDmsResultReadPort {
  async fetchResult(
    connection: InspectionConnectionContext,
    nativeResultReference: string,
  ): Promise<EbvFetchEnvelope> {
    if (connection.profileId !== 'TEST_ONLY') {
      return { status: 'NOT_CONFIGURED' };
    }
    const canonical = lookupSyntheticCanonicalResult(nativeResultReference);
    if (!canonical) {
      return { status: 'NOT_FOUND' };
    }
    const bound = {
      ...canonical,
      source_account_ref: connection.sourceAccountRef,
      source_station_id: connection.sourceStationId,
    };
    return {
      status: 'RESULT',
      canonical: bound,
      originalUtf8: JSON.stringify(bound),
      trustedReceipt: true,
    };
  }
}
