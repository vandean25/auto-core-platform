import { CHECK_IN_ERROR_CODES } from './workshop-check-in.rules.js';
import {
  CHECK_IN_MEDIA_UPLOADER_REQUIRED_MESSAGE,
  resolveCheckInMediaUploaderEmployeeId,
} from './workshop-check-in-media-attribution.js';

describe('resolveCheckInMediaUploaderEmployeeId', () => {
  const tenantContext = {
    getAuthenticatedUser: jest.fn(),
  };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('returns the employee id when the session userId matches the linked user', async () => {
    tenantContext.getAuthenticatedUser.mockReturnValue({
      userId: 'firebase-uid',
      email: 'advisor@workshop.at',
    });
    const prisma = {
      employee: {
        findFirst: jest.fn().mockResolvedValue({ id: 'emp-1' }),
      },
    };

    await expect(
      resolveCheckInMediaUploaderEmployeeId(
        prisma as never,
        tenantContext as never,
        'tenant-1',
      ),
    ).resolves.toBe('emp-1');

    expect(prisma.employee.findFirst).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-1',
        is_active: true,
        user: {
          OR: [
            { firebaseUid: 'firebase-uid' },
            { email: 'advisor@workshop.at' },
          ],
        },
      },
      select: { id: true },
    });
  });

  it('returns the employee id when only the session email matches the linked user', async () => {
    tenantContext.getAuthenticatedUser.mockReturnValue({
      userId: 'other-firebase-uid',
      email: 'advisor@workshop.at',
    });
    const prisma = {
      employee: {
        findFirst: jest.fn().mockResolvedValue({ id: 'emp-email' }),
      },
    };

    await expect(
      resolveCheckInMediaUploaderEmployeeId(
        prisma as never,
        tenantContext as never,
        'tenant-1',
      ),
    ).resolves.toBe('emp-email');
  });

  it('rejects when no active employee is linked to the user', async () => {
    tenantContext.getAuthenticatedUser.mockReturnValue({
      userId: 'firebase-uid',
      email: 'advisor@workshop.at',
    });
    const prisma = {
      employee: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    await expect(
      resolveCheckInMediaUploaderEmployeeId(
        prisma as never,
        tenantContext as never,
        'tenant-1',
      ),
    ).rejects.toMatchObject({
      response: {
        code: CHECK_IN_ERROR_CODES.CHECK_IN_MEDIA_UPLOADER_REQUIRED,
        message: CHECK_IN_MEDIA_UPLOADER_REQUIRED_MESSAGE,
      },
    });
  });
});
