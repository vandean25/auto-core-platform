import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export const VEHICLE_VALUATION_PROVIDER = Symbol('VEHICLE_VALUATION_PROVIDER');

export const VALUATION_CONTRACT_VERSION = 'acp-valuation-contract-1';

export type ValuationCondition =
  | 'ROADWORTHY_AVERAGE'
  | 'POOR'
  | 'NOT_ROADWORTHY';

export interface ValuationQuoteInput {
  market: 'AT';
  valuationType: 'MARKET_VALUE';
  nationalCode: string;
  mileageKm: number;
  condition: ValuationCondition;
  requestedAsOf: string;
  currency: 'EUR';
  contractVersion: typeof VALUATION_CONTRACT_VERSION;
}

export type ValuationQuoteResult =
  | 'QUOTED'
  | 'AMBIGUOUS_VARIANT'
  | 'REFERENCE_VERSION_UNKNOWN'
  | 'AS_OF_UNKNOWN'
  | 'CURRENCY_CONFLICT';

export interface ValuationQuoteOutput {
  result: ValuationQuoteResult;
  amount: string | null;
  currency: 'EUR' | null;
  source: 'EUROTAX_AT_AUTOVALUATION' | null;
  sourceState: 'KNOWN' | 'UNKNOWN';
  providerAsOf: string | null;
  asOfState: 'KNOWN' | 'AS_OF_UNKNOWN';
  referenceVersion: string | null;
  referenceVersionState: 'KNOWN' | 'REFERENCE_VERSION_UNKNOWN';
  nativeId: null;
  nativeIdState: 'NATIVE_ID_UNKNOWN';
  candidates?: { nationalCode: string; label: string }[];
}

export interface VehicleValuationProvider {
  isAvailable(): boolean;
  quote(
    input: ValuationQuoteInput,
    signal: AbortSignal,
  ): Promise<ValuationQuoteOutput>;
}

@Injectable()
export class DisabledEurotaxAtVehicleValuationProvider implements VehicleValuationProvider {
  isAvailable(): boolean {
    return false;
  }

  quote(): Promise<ValuationQuoteOutput> {
    throw new ServiceUnavailableException({
      code: 'VALUATION_PROVIDER_UNAVAILABLE',
      message: 'VALUATION_PROVIDER_UNAVAILABLE',
      result: 'PROVIDER_UNAVAILABLE',
    });
  }
}
