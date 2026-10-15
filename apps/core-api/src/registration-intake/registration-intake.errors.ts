import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

export function registrationIntakeNotFound(id: string): NotFoundException {
  return new NotFoundException(`Registration intake ${id} not found`);
}

export function registrationIntakeRoleForbidden(): ForbiddenException {
  return new ForbiddenException(
    'Registration intake is limited to OWNER, ADMIN, and SALES.',
  );
}

export function registrationIdempotencyKeyInvalid(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'REGISTRATION_INTAKE_IDEMPOTENCY_KEY_INVALID',
    message:
      'REGISTRATION_INTAKE_IDEMPOTENCY_KEY_INVALID: A valid Idempotency-Key header is required.',
  });
}

export function registrationIdempotencyConflict(): ConflictException {
  return new ConflictException({
    code: 'REGISTRATION_INTAKE_IDEMPOTENCY_CONFLICT',
    message:
      'REGISTRATION_INTAKE_IDEMPOTENCY_CONFLICT: The idempotency key was already used for another request.',
  });
}

export function registrationInProgress(): ConflictException {
  return new ConflictException({
    code: 'REGISTRATION_INTAKE_IN_PROGRESS',
    message:
      'REGISTRATION_INTAKE_IN_PROGRESS: An intake with this idempotency key is still running.',
  });
}

export function registrationStateChanged(): ConflictException {
  return new ConflictException({
    code: 'REGISTRATION_INTAKE_STATE_CHANGED',
    message:
      'REGISTRATION_INTAKE_STATE_CHANGED: The intake changed; please reload.',
  });
}

export function registrationAppliedDelete(): ConflictException {
  return new ConflictException({
    code: 'REGISTRATION_INTAKE_APPLIED',
    message:
      'REGISTRATION_INTAKE_APPLIED: An applied intake cannot be deleted.',
  });
}

export function registrationBytesRemain(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'REGISTRATION_INTAKE_BYTES_REMAIN',
    message: 'REGISTRATION_INTAKE_BYTES_REMAIN: The file could not be deleted.',
  });
}

export function registrationUnsupportedFile(): BadRequestException {
  return new BadRequestException({
    code: 'REGISTRATION_INTAKE_UNSUPPORTED_FILE',
    message:
      'REGISTRATION_INTAKE_UNSUPPORTED_FILE: The file must be JPEG, PNG, or PDF.',
  });
}

export function registrationStoreFailed(): BadRequestException {
  return new BadRequestException({
    code: 'REGISTRATION_INTAKE_STORE_FAILED',
    message:
      'REGISTRATION_INTAKE_STORE_FAILED: The uploaded file could not be stored.',
  });
}

export function registrationTooManyFiles(): BadRequestException {
  return new BadRequestException({
    code: 'REGISTRATION_INTAKE_TOO_MANY_FILES',
    message:
      'REGISTRATION_INTAKE_TOO_MANY_FILES: At most 2 files are accepted.',
  });
}

export function registrationFileTooLarge(): HttpException {
  return new HttpException(
    {
      code: 'REGISTRATION_INTAKE_FILE_TOO_LARGE',
      message:
        'REGISTRATION_INTAKE_FILE_TOO_LARGE: Each file must be at most 10 MiB.',
    },
    HttpStatus.PAYLOAD_TOO_LARGE,
  );
}

export function registrationIdMismatch(): BadRequestException {
  return new BadRequestException({
    code: 'REGISTRATION_INTAKE_ID_MISMATCH',
    message:
      'REGISTRATION_INTAKE_ID_MISMATCH: The intake id is taken from the path.',
  });
}

export function registrationLowConfidence(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'REGISTRATION_INTAKE_LOW_CONFIDENCE',
    message:
      'REGISTRATION_INTAKE_LOW_CONFIDENCE: A low-confidence identity field cannot be saved.',
  });
}

export function registrationVehicleIdentityIncomplete(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'REGISTRATION_INTAKE_VEHICLE_IDENTITY_INCOMPLETE',
    message:
      'REGISTRATION_INTAKE_VEHICLE_IDENTITY_INCOMPLETE: make, model, and year are required to create a vehicle.',
  });
}

export function registrationConfirmationMismatch(): ConflictException {
  return new ConflictException({
    code: 'REGISTRATION_INTAKE_CONFIRMATION_MISMATCH',
    message:
      'REGISTRATION_INTAKE_CONFIRMATION_MISMATCH: Confirmed identity fields do not match the stored evidence.',
  });
}

export function registrationWrongDocument(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'REGISTRATION_INTAKE_WRONG_DOCUMENT',
    message:
      'REGISTRATION_INTAKE_WRONG_DOCUMENT: The file is not an Austrian Zulassungsschein.',
  });
}

export function registrationIllegible(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'REGISTRATION_INTAKE_ILLEGIBLE',
    message: 'REGISTRATION_INTAKE_ILLEGIBLE: No identity field could be read.',
  });
}

export function registrationConflictingVin(): ConflictException {
  return new ConflictException({
    code: 'REGISTRATION_INTAKE_CONFLICTING_VIN',
    message:
      'REGISTRATION_INTAKE_CONFLICTING_VIN: The document VIN does not match the selected vehicle.',
  });
}

export function registrationInvalidVin(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'REGISTRATION_INTAKE_INVALID_VIN',
    message:
      'REGISTRATION_INTAKE_INVALID_VIN: The VIN is not 17 valid characters.',
  });
}

export function registrationNationalcodeLooksLikeVin(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'REGISTRATION_INTAKE_NATIONALCODE_LOOKS_LIKE_VIN',
    message:
      'REGISTRATION_INTAKE_NATIONALCODE_LOOKS_LIKE_VIN: Nationalcode cannot be stored.',
  });
}

export function registrationAmbiguousMatch(): ConflictException {
  return new ConflictException({
    code: 'REGISTRATION_INTAKE_AMBIGUOUS_MATCH',
    message:
      'REGISTRATION_INTAKE_AMBIGUOUS_MATCH: More than one customer or vehicle matches.',
  });
}

export function registrationOwnershipConflict(): ConflictException {
  return new ConflictException({
    code: 'REGISTRATION_INTAKE_OWNERSHIP_CONFLICT',
    message:
      'REGISTRATION_INTAKE_OWNERSHIP_CONFLICT: The vehicle is linked to a different customer.',
  });
}

export function registrationFieldConflict(): ConflictException {
  return new ConflictException({
    code: 'REGISTRATION_INTAKE_FIELD_CONFLICT',
    message:
      'REGISTRATION_INTAKE_FIELD_CONFLICT: Stored Nationalcode, first registration, or CO2 differs from the document.',
  });
}
