import { createHash } from 'node:crypto';
import { normalizeVehicleIdentityValue } from './vehicle-identity.util.js';
import {
  VALUATION_CONTRACT_VERSION,
  type ValuationCondition,
  type ValuationQuoteOutput,
} from './vehicle-valuation.provider.js';

export const VIENNA_TIME_ZONE = 'Europe/Vienna';

export const VALUATION_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;

const SIX_DIGIT_NATIONAL_CODE = /^[0-9]{6}$/;

export function todayInViennaYmd(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: VIENNA_TIME_ZONE,
  }).format(now);
}

export function isValuationStale(
  providerAsOf: string,
  now: Date = new Date(),
): boolean {
  return providerAsOf < todayInViennaYmd(now);
}

export function createValuationInputSha256(input: {
  vehicleId: string;
  nationalCode: string;
  valuationType: 'MARKET_VALUE';
  mileageKm: number;
  condition: ValuationCondition;
  requestedAsOf: string;
  currency: 'EUR';
  contractVersion: typeof VALUATION_CONTRACT_VERSION;
}): string {
  const canonical = JSON.stringify({
    vehicleId: input.vehicleId,
    nationalCode: input.nationalCode,
    valuationType: input.valuationType,
    mileageKm: input.mileageKm,
    condition: input.condition,
    requestedAsOf: input.requestedAsOf,
    currency: input.currency,
    contractVersion: input.contractVersion,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function hashValuationProviderBody(output: ValuationQuoteOutput): string {
  const canonical = JSON.stringify(output);
  return createHash('sha256').update(canonical).digest('hex');
}

export function normalizeNationalCodeCandidate(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function assessNationalCodeIdentity(input: {
  nationalCode: string | null | undefined;
  vin: string | null | undefined;
  typenscheinNo: string | null | undefined;
}): { ok: true; nationalCode: string } | { ok: false } {
  const code = normalizeNationalCodeCandidate(input.nationalCode);
  if (!code) {
    return { ok: false };
  }
  if (!SIX_DIGIT_NATIONAL_CODE.test(code)) {
    return { ok: false };
  }
  if (code.length === 17) {
    return { ok: false };
  }
  const normalizedVin = normalizeVehicleIdentityValue(input.vin ?? '');
  if (normalizedVin && code.toUpperCase() === normalizedVin) {
    return { ok: false };
  }
  const typenschein = normalizeNationalCodeCandidate(input.typenscheinNo);
  if (typenschein && code === typenschein) {
    return { ok: false };
  }
  return { ok: true, nationalCode: code };
}

export function resolveRequestedAsOf(
  requestedAsOf: string | undefined,
  now: Date = new Date(),
): string {
  return requestedAsOf?.trim() || todayInViennaYmd(now);
}

export function assertRequestedAsOfInRange(
  requestedAsOf: string,
  firstRegistrationDate: Date | null | undefined,
  now: Date = new Date(),
): void {
  const today = todayInViennaYmd(now);
  if (requestedAsOf > today) {
    throw new Error('VALUATION_REQUESTED_AS_OF_FUTURE');
  }
  if (firstRegistrationDate) {
    const registrationYmd = firstRegistrationDate.toISOString().slice(0, 10);
    if (requestedAsOf < registrationYmd) {
      throw new Error('VALUATION_REQUESTED_AS_OF_BEFORE_REGISTRATION');
    }
  }
}
