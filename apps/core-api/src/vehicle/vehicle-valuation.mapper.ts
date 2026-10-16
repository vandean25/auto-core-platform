import type { VehicleValuationSnapshot } from '@prisma/client';
import { VALUATION_CONTRACT_VERSION } from './vehicle-valuation.provider.js';
import { isValuationStale } from './vehicle-valuation.util.js';

export function mapSnapshotToQuotedResponse(
  row: VehicleValuationSnapshot,
  now: Date = new Date(),
) {
  const providerAsOf = row.provider_as_of.toISOString().slice(0, 10);
  const requestedAsOf = row.requested_as_of.toISOString().slice(0, 10);
  return {
    id: row.id,
    result: 'QUOTED' as const,
    amount: row.amount.toFixed(2),
    currency: 'EUR' as const,
    source: 'EUROTAX_AT_AUTOVALUATION' as const,
    sourceState: 'KNOWN' as const,
    requestedAsOf,
    providerAsOf,
    asOfState: 'KNOWN' as const,
    referenceVersion: row.reference_version,
    referenceVersionState: 'KNOWN' as const,
    contractVersion: row.contract_version,
    nativeId: null,
    nativeIdState: 'NATIVE_ID_UNKNOWN' as const,
    nationalCode: row.national_code,
    mileageKm: row.mileage_km,
    condition: row.condition,
    stale: isValuationStale(providerAsOf, now),
    createdAt: row.createdAt.toISOString(),
  };
}

export function buildQuotedResponseFromOutput(
  input: {
    nationalCode: string;
    mileageKm: number;
    condition: string;
    requestedAsOf: string;
    id: string;
    createdAt: Date;
  },
  output: {
    amount: string;
    providerAsOf: string;
    referenceVersion: string;
  },
  now: Date = new Date(),
) {
  return {
    id: input.id,
    result: 'QUOTED' as const,
    amount: output.amount,
    currency: 'EUR' as const,
    source: 'EUROTAX_AT_AUTOVALUATION' as const,
    sourceState: 'KNOWN' as const,
    requestedAsOf: input.requestedAsOf,
    providerAsOf: output.providerAsOf,
    asOfState: 'KNOWN' as const,
    referenceVersion: output.referenceVersion,
    referenceVersionState: 'KNOWN' as const,
    contractVersion: VALUATION_CONTRACT_VERSION,
    nativeId: null,
    nativeIdState: 'NATIVE_ID_UNKNOWN' as const,
    nationalCode: input.nationalCode,
    mileageKm: input.mileageKm,
    condition: input.condition,
    stale: isValuationStale(output.providerAsOf, now),
    createdAt: input.createdAt.toISOString(),
  };
}

export function buildProviderFailureBody(
  result: string,
  output: {
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
  },
  requestedAsOf: string,
) {
  return {
    result,
    amount: output.amount,
    currency: output.currency,
    source: output.source,
    sourceState: output.sourceState,
    requestedAsOf,
    providerAsOf: output.providerAsOf,
    asOfState: output.asOfState,
    referenceVersion: output.referenceVersion,
    referenceVersionState: output.referenceVersionState,
    contractVersion: VALUATION_CONTRACT_VERSION,
    nativeId: output.nativeId,
    nativeIdState: output.nativeIdState,
    ...(output.candidates ? { candidates: output.candidates } : {}),
  };
}
