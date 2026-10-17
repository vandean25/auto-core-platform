import { ConflictException } from '@nestjs/common';
import { WorkshopCheckInStatus } from '@prisma/client';
import { CHECK_IN_ERROR_CODES } from './workshop-check-in.rules.js';

export function assertCheckInDraftForMutation(
  status: WorkshopCheckInStatus,
): void {
  if (status === WorkshopCheckInStatus.COMPLETED) {
    throw new ConflictException({
      code: CHECK_IN_ERROR_CODES.CHECK_IN_COMPLETED,
      message: 'Completed check-in records cannot be changed.',
    });
  }
}
