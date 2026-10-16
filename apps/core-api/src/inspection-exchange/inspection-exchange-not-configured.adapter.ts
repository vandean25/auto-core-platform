import { Injectable } from '@nestjs/common';
import type { EbvDmsResultReadPort } from './inspection-exchange.port.js';
import type {
  EbvFetchEnvelope,
  InspectionConnectionContext,
} from './inspection-exchange.types.js';

/** Native EBV profile adapter — default-off until evidenced contract exists (AUT-593). */
@Injectable()
export class NotConfiguredEbvDmsResultReadAdapter implements EbvDmsResultReadPort {
  fetchResult(
    _connection: InspectionConnectionContext,
    _nativeResultReference: string,
  ): Promise<EbvFetchEnvelope> {
    return Promise.resolve({ status: 'NOT_CONFIGURED' });
  }
}
