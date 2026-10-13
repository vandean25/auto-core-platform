import { PrismaService } from '../prisma/prisma.service.js';
import { DocumentBrandingUploadRequeueService } from './document-branding-upload-requeue.service.js';
import { DocumentBrandingUploadTaskService } from './document-branding-upload-task.service.js';

describe('DocumentBrandingUploadRequeueService', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  let prisma: {
    documentBrandAsset: { updateMany: jest.Mock; findMany: jest.Mock };
  };
  let tasks: { enqueue: jest.Mock };
  let service: DocumentBrandingUploadRequeueService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      documentBrandAsset: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    tasks = { enqueue: jest.fn().mockResolvedValue(undefined) };
    service = new DocumentBrandingUploadRequeueService(
      prisma as unknown as PrismaService,
      tasks as unknown as DocumentBrandingUploadTaskService,
    );
  });

  it('rejects quarantined uploads that have used up their validation attempts', async () => {
    await service.rejectExhausted(now);

    expect(prisma.documentBrandAsset.updateMany).toHaveBeenCalledWith({
      where: {
        state: 'QUARANTINED',
        validation_attempt_count: { gte: 3 },
        validation_lease_until: { lt: now },
      },
      data: {
        state: 'REJECTED',
        failure_code: 'VALIDATION_RETRIES_EXHAUSTED',
        expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        validation_lease_until: null,
      },
    });
  });

  it('requeues stalled validations and keeps going when one dispatch fails', async () => {
    prisma.documentBrandAsset.findMany.mockResolvedValue([
      { id: 'asset-1', tenant_id: 'tenant-1' },
      { id: 'asset-2', tenant_id: 'tenant-1' },
    ]);
    tasks.enqueue
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('queue unavailable'));

    await expect(service.requeuePending(now)).resolves.toBeUndefined();
    expect(tasks.enqueue).toHaveBeenNthCalledWith(1, {
      assetId: 'asset-1',
      tenantId: 'tenant-1',
    });
    expect(tasks.enqueue).toHaveBeenNthCalledWith(2, {
      assetId: 'asset-2',
      tenantId: 'tenant-1',
    });
  });
});
