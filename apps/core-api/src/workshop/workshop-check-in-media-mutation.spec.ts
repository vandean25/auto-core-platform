import { ConflictException } from '@nestjs/common';
import { WorkshopCheckInStatus } from '@prisma/client';
import {
  assertCheckInAllowsMediaDetach,
  assertCheckInAllowsMediaMutation,
} from './workshop-check-in-media-validation.js';

describe('check-in media mutation guards', () => {
  it('rejects attach and detach when the check-in is completed', async () => {
    const db = {
      workshopCheckIn: {
        findFirst: jest.fn().mockResolvedValue({
          status: WorkshopCheckInStatus.COMPLETED,
        }),
      },
      workshopMedia: { findMany: jest.fn() },
    };

    await expect(
      assertCheckInAllowsMediaMutation(db as never, 'tenant-1', 'check-in-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      assertCheckInAllowsMediaDetach(db as never, 'tenant-1', 'check-in-1'),
    ).rejects.toMatchObject({
      response: { code: 'CHECK_IN_COMPLETED' },
    });
  });
});
