import type {
  EbvFetchEnvelope,
  InspectionConnectionContext,
} from './inspection-exchange.types.js';

export const EBV_DMS_RESULT_READ_PORT = Symbol('EBV_DMS_RESULT_READ_PORT');

export interface EbvDmsResultReadPort {
  fetchResult(
    connection: InspectionConnectionContext,
    nativeResultReference: string,
  ): Promise<EbvFetchEnvelope>;
}
