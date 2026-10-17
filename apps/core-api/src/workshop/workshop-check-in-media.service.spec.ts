import { CHECK_IN_ERROR_CODES } from './workshop-check-in.rules.js';
import { resolveCheckInMediaUploaderEmployeeId } from './workshop-check-in-media-attribution.js';

describe('WorkshopCheckInMediaService', () => {
  it('rejects uploads when no employee is linked to the user', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }) },
      employee: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const tenantContext = {
      getAuthenticatedUser: () => ({
        userId: 'firebase-uid',
        tenantId: 'tenant-1',
      }),
    };

    await expect(
      resolveCheckInMediaUploaderEmployeeId(
        prisma as never,
        tenantContext as never,
        'tenant-1',
      ),
    ).rejects.toMatchObject({
      response: { code: CHECK_IN_ERROR_CODES.CHECK_IN_MEDIA_UPLOADER_REQUIRED },
    });
  });
});
