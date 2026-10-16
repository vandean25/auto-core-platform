import { Injectable } from '@nestjs/common';
import type { EbvDmsResultReadPort } from './inspection-exchange.port.js';
import type {
  EbvFetchEnvelope,
  InspectionConnectionContext,
} from './inspection-exchange.types.js';
import { lookupSyntheticCanonicalResult } from './inspection-exchange-synthetic-fixtures.js';

@Injectable()
export class FakeEbvDmsResultReadAdapter implements EbvDmsResultReadPort {
  fetchResult(
    connection: InspectionConnectionContext,
    nativeResultReference: string,
  ): Promise<EbvFetchEnvelope> {
    if (connection.profileId !== 'TEST_ONLY') {
      return Promise.resolve({ status: 'NOT_CONFIGURED' });
    }
    const canonical = lookupSyntheticCanonicalResult(nativeResultReference);
    if (!canonical) {
      return Promise.resolve({ status: 'NOT_FOUND' });
    }
    const trustedReceipt =
      canonical.acknowledgement.state === 'CONFIRMED' &&
      canonical.acknowledgement.evidence_type === 'TEST_ONLY_FINAL_RECEIPT' &&
      Boolean(canonical.acknowledgement.evidence_ref);

    return Promise.resolve({
      status: 'RESULT',
      canonical,
      originalUtf8: JSON.stringify(canonical),
      trustedReceipt,
    });
  }
}
