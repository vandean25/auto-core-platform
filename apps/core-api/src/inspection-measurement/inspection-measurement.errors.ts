import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

export function measurementNotConfigured() {
  return new UnprocessableEntityException({ code: 'NOT_CONFIGURED' });
}

export function unsupportedSchemaVersion() {
  return new UnprocessableEntityException({
    code: 'UNSUPPORTED_SCHEMA_VERSION',
  });
}

export function unsupportedUnit() {
  return new UnprocessableEntityException({ code: 'UNSUPPORTED_UNIT' });
}

export function invalidMeasurementPayload(message?: string) {
  return new BadRequestException({
    code: 'INVALID_MEASUREMENT_PAYLOAD',
    message,
  });
}

export function vehicleIdentityMismatch() {
  return new UnprocessableEntityException({
    code: 'VEHICLE_IDENTITY_MISMATCH',
  });
}

export function deviceBindingMismatch() {
  return new UnprocessableEntityException({
    code: 'DEVICE_BINDING_MISMATCH',
  });
}

export function implausibleMeasurement() {
  return new UnprocessableEntityException({
    code: 'IMPLAUSIBLE_MEASUREMENT',
  });
}

export function measurementConflict() {
  return new ConflictException({ code: 'MEASUREMENT_CONFLICT' });
}

export function reviewRequired() {
  return new ConflictException({ code: 'REVIEW_REQUIRED' });
}

export function measurementImportNotFound(importId: string) {
  return new NotFoundException(
    `Inspection measurement import ${importId} not found`,
  );
}

export function workshopOrderNotFound() {
  return new NotFoundException('Workshop order not found');
}

export function deviceSourceNotFound() {
  return new NotFoundException('Inspection device source not found');
}

export function measurementImportForbidden() {
  return new ForbiddenException(
    'Insufficient role for brake measurement import',
  );
}

export function measurementReadForbidden() {
  return new ForbiddenException(
    'Insufficient role to read brake measurements',
  );
}
