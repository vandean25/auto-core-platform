import type {
  ValuationQuoteInput,
  ValuationQuoteOutput,
  VehicleValuationProvider,
} from './vehicle-valuation.provider.js';

/**
 * Test-only provider that maps synthetic national codes to fixture outcomes.
 * Not registered in production.
 */
export class FixtureVehicleValuationProvider implements VehicleValuationProvider {
  isAvailable(): boolean {
    return true;
  }

  quote(input: ValuationQuoteInput): Promise<ValuationQuoteOutput> {
    const { nationalCode, requestedAsOf } = input;

    if (nationalCode === '100530') {
      return Promise.resolve({
        result: 'AMBIGUOUS_VARIANT',
        amount: null,
        currency: null,
        source: 'EUROTAX_AT_AUTOVALUATION',
        sourceState: 'KNOWN',
        providerAsOf: '2026-10-15',
        asOfState: 'KNOWN',
        referenceVersion: 'synthetic-ref-2026-10',
        referenceVersionState: 'KNOWN',
        nativeId: null,
        nativeIdState: 'NATIVE_ID_UNKNOWN',
        candidates: [
          { nationalCode: '100530', label: 'synthetic variant A' },
          { nationalCode: '100531', label: 'synthetic variant B' },
        ],
      });
    }

    if (nationalCode === '100532') {
      return Promise.resolve({
        result: 'REFERENCE_VERSION_UNKNOWN',
        amount: null,
        currency: null,
        source: 'EUROTAX_AT_AUTOVALUATION',
        sourceState: 'KNOWN',
        providerAsOf: '2026-10-15',
        asOfState: 'KNOWN',
        referenceVersion: null,
        referenceVersionState: 'REFERENCE_VERSION_UNKNOWN',
        nativeId: null,
        nativeIdState: 'NATIVE_ID_UNKNOWN',
      });
    }

    if (nationalCode === '100533') {
      return Promise.resolve({
        result: 'AS_OF_UNKNOWN',
        amount: null,
        currency: 'EUR',
        source: 'EUROTAX_AT_AUTOVALUATION',
        sourceState: 'KNOWN',
        providerAsOf: null,
        asOfState: 'AS_OF_UNKNOWN',
        referenceVersion: 'synthetic-ref-2026-10',
        referenceVersionState: 'KNOWN',
        nativeId: null,
        nativeIdState: 'NATIVE_ID_UNKNOWN',
      });
    }

    if (nationalCode === '100531') {
      return Promise.resolve({
        result: 'QUOTED',
        amount: '4200.00',
        currency: 'EUR',
        source: 'EUROTAX_AT_AUTOVALUATION',
        sourceState: 'KNOWN',
        providerAsOf: '2026-10-15',
        asOfState: 'KNOWN',
        referenceVersion: 'synthetic-ref-2026-10',
        referenceVersionState: 'KNOWN',
        nativeId: null,
        nativeIdState: 'NATIVE_ID_UNKNOWN',
      });
    }

    if (nationalCode === '100527' && requestedAsOf === '2026-10-01') {
      return Promise.resolve({
        result: 'QUOTED',
        amount: '15100.00',
        currency: 'EUR',
        source: 'EUROTAX_AT_AUTOVALUATION',
        sourceState: 'KNOWN',
        providerAsOf: '2026-10-01',
        asOfState: 'KNOWN',
        referenceVersion: 'synthetic-ref-2026-09',
        referenceVersionState: 'KNOWN',
        nativeId: null,
        nativeIdState: 'NATIVE_ID_UNKNOWN',
      });
    }

    if (nationalCode === '100527') {
      return Promise.resolve({
        result: 'QUOTED',
        amount: '14850.00',
        currency: 'EUR',
        source: 'EUROTAX_AT_AUTOVALUATION',
        sourceState: 'KNOWN',
        providerAsOf: '2026-10-15',
        asOfState: 'KNOWN',
        referenceVersion: 'synthetic-ref-2026-10',
        referenceVersionState: 'KNOWN',
        nativeId: null,
        nativeIdState: 'NATIVE_ID_UNKNOWN',
      });
    }

    return Promise.resolve({
      result: 'CURRENCY_CONFLICT',
      amount: '1.00',
      currency: null,
      source: null,
      sourceState: 'UNKNOWN',
      providerAsOf: null,
      asOfState: 'AS_OF_UNKNOWN',
      referenceVersion: null,
      referenceVersionState: 'REFERENCE_VERSION_UNKNOWN',
      nativeId: null,
      nativeIdState: 'NATIVE_ID_UNKNOWN',
    });
  }
}
