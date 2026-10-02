import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  LOANER_ALREADY_RETURNED,
  LOANER_BOOKING_OVERLAP,
  LOANER_FLEET_DELETE_BLOCKED,
  LOANER_FLEET_NOT_BOOKABLE,
  LOANER_FORBIDDEN_WRITE,
  LOANER_INVALID_HANDOVER_STATE,
  LOANER_ODOMETER_IN_INVALID,
  LOANER_RETURN_BEFORE_HANDOVER,
  LOANER_VEHICLE_ON_LOAN,
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

export function loanerVehicleOnLoanException(): ConflictException {
  return new ConflictException({
    code: LOANER_VEHICLE_ON_LOAN,
    message: 'This loaner vehicle is already handed over on another booking.',
  });
}

export function loanerFleetDeleteBlockedException(): ConflictException {
  return new ConflictException({
    code: LOANER_FLEET_DELETE_BLOCKED,
    message: 'Cannot remove a loaner vehicle that has booking history.',
  });
}

export function loanerFleetNotBookableException(
  message = 'This loaner vehicle cannot be booked in its current state.',
): BadRequestException {
  return new BadRequestException({
    code: LOANER_FLEET_NOT_BOOKABLE,
    message,
  });
}
