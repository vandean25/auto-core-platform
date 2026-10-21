import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

export function valuationIdempotencyKeyInvalid(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'VALUATION_IDEMPOTENCY_KEY_INVALID',
    message:
      'VALUATION_IDEMPOTENCY_KEY_INVALID: A valid Idempotency-Key header is required.',
  });
}

export function valuationSiteRequired(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'VALUATION_SITE_REQUIRED',
    message: 'VALUATION_SITE_REQUIRED: Stock vehicles must have a site.',
    result: 'VALUATION_SITE_REQUIRED',
  });
}

export function valuationTypeUnsupported(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'VALUATION_TYPE_UNSUPPORTED',
    message: 'VALUATION_TYPE_UNSUPPORTED: Only MARKET_VALUE is supported.',
    result: 'VALUATION_TYPE_UNSUPPORTED',
  });
}

export function valuationVehicleNotFound(vehicleId: string): NotFoundException {
  return new NotFoundException(`Vehicle with ID ${vehicleId} not found`);
}

export function valuationUncertainIdentity(
  body: Record<string, unknown>,
): UnprocessableEntityException {
  return new UnprocessableEntityException(body);
}

export function valuationMissingData(
  body: Record<string, unknown>,
): UnprocessableEntityException {
  return new UnprocessableEntityException(body);
}

export function valuationProviderResult(
  statusCode: number,
  body: Record<string, unknown>,
): UnprocessableEntityException | ConflictException {
  if (statusCode === 409) {
    return new ConflictException(body);
  }
  return new UnprocessableEntityException(body);
}

export function valuationConflictReplay(
  body: Record<string, unknown>,
): ConflictException {
  return new ConflictException(body);
}

export function valuationProviderUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'VALUATION_PROVIDER_UNAVAILABLE',
    message: 'VALUATION_PROVIDER_UNAVAILABLE',
    result: 'PROVIDER_UNAVAILABLE',
    amount: null,
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
