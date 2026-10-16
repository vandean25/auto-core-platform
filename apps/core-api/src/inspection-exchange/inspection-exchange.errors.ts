import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

export function exchangeNotConfigured() {
  return new UnprocessableEntityException({
    code: 'EXCHANGE_NOT_CONFIGURED',
  });
}

export function unsupportedSchemaVersion() {
  return new UnprocessableEntityException({
    code: 'UNSUPPORTED_SCHEMA_VERSION',
  });
}

export function unsupportedUnit() {
  return new UnprocessableEntityException({
    code: 'UNSUPPORTED_UNIT',
  });
}

export function invalidInspectionPayload(message?: string) {
  return new BadRequestException({
    code: 'INVALID_INSPECTION_PAYLOAD',
    message,
  });
}

export function vehicleIdentityMismatch() {
  return new UnprocessableEntityException({
    code: 'VEHICLE_IDENTITY_MISMATCH',
  });
}

export function stationMismatch() {
  return new UnprocessableEntityException({
    code: 'STATION_MISMATCH',
  });
}

export function accountMismatch() {
  return new UnprocessableEntityException({
    code: 'STATION_MISMATCH',
  });
}

export function resultUnconfirmed() {
  return new UnprocessableEntityException({
    code: 'RESULT_UNCONFIRMED',
  });
}

export function externalResultConflict() {
  return new ConflictException({
    code: 'EXTERNAL_RESULT_CONFLICT',
  });
}

export function reviewRequired() {
  return new ConflictException({
    code: 'REVIEW_REQUIRED',
  });
}

export function importNotFound(importId: string) {
  return new NotFoundException(`Inspection import ${importId} not found`);
}

export function resultNotFound(resultId: string) {
  return new NotFoundException(
    `External inspection result ${resultId} not found`,
  );
}

export function connectionNotFound() {
  return new NotFoundException('Inspection source connection not found');
}

export function vehicleNotFound() {
  return new NotFoundException('Vehicle not found');
}

export function inspectionImportForbidden() {
  return new ForbiddenException('Insufficient role for inspection import');
}
