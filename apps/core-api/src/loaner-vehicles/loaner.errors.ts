import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  LOANER_ALREADY_RETURNED,
  LOANER_BOOKING_OVERLAP,
  LOANER_FORBIDDEN_WRITE,
  LOANER_INVALID_HANDOVER_STATE,
  LOANER_ODOMETER_IN_INVALID,
  LOANER_RETURN_BEFORE_HANDOVER,
} from './loaner.constants.js';

export function loanerOverlapException(): ConflictException {
  return new ConflictException({
    code: LOANER_BOOKING_OVERLAP,
    message: 'The loaner vehicle already has an overlapping active booking.',
  });
}

export function loanerForbiddenWriteException(): ForbiddenException {
  return new ForbiddenException({
    code: LOANER_FORBIDDEN_WRITE,
    message:
      'You do not have permission to modify loaner vehicles or bookings.',
  });
}

export function loanerReturnBeforeHandoverException(): BadRequestException {
  return new BadRequestException({
    code: LOANER_RETURN_BEFORE_HANDOVER,
    message: 'The booking must be handed over before it can be returned.',
  });
}

export function loanerOdometerInInvalidException(): BadRequestException {
  return new BadRequestException({
    code: LOANER_ODOMETER_IN_INVALID,
    message:
      'Return odometer must be greater than or equal to handover odometer.',
  });
}

export function loanerAlreadyReturnedException(): BadRequestException {
  return new BadRequestException({
    code: LOANER_ALREADY_RETURNED,
    message: 'This loaner booking has already been returned or closed.',
  });
}

export function loanerInvalidHandoverStateException(
  message = 'Booking must be reserved before handover.',
): BadRequestException {
  return new BadRequestException({
    code: LOANER_INVALID_HANDOVER_STATE,
    message,
  });
}
