import { PrismaService } from '../prisma/prisma.service.js';
import { CloudTasksService } from '../common/services/cloud-tasks.service.js';
import { DocumentBrandingExtractionTaskService } from './document-branding-extraction-task.service.js';

describe('DocumentBrandingExtractionTaskService', () => {
  const cloudTasks = {
    enqueueDocumentBrandingExtraction: jest.fn(),
  } as unknown as CloudTasksService;
  const prisma = {
    documentBrandExtraction: { updateMany: jest.fn() },
  } as unknown as PrismaService;
  let service: DocumentBrandingExtractionTaskService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(cloudTasks.enqueueDocumentBrandingExtraction).mockResolvedValue({
      taskId: 'task-1',
    });
    jest.mocked(prisma.documentBrandExtraction.updateMany).mockResolvedValue({
      count: 1,
    });
    service = new DocumentBrandingExtractionTaskService(cloudTasks, prisma);
  });

  it('records dispatch only after Cloud Tasks accepts the job', async () => {
    await service.enqueue({
      extractionId: 'extraction-1',
      legalEntityId: 'entity-1',
      tenantId: 'tenant-1',
      expectedAttemptCount: 0,
    });

    expect(cloudTasks.enqueueDocumentBrandingExtraction).toHaveBeenCalledWith(
      expect.objectContaining({ expectedAttemptCount: 0 }),
    );
    expect(prisma.documentBrandExtraction.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'extraction-1',
        tenant_id: 'tenant-1',
        legal_entity_id: 'entity-1',
        state: 'QUEUED',
        attempt_count: 0,
        dispatched_at: null,
      },
      data: {
        dispatched_at: expect.any(Date),
        dispatch_count: { increment: 1 },
      },
    });
  });

  it('does not stamp a second dispatch when the worker claimed before bookkeeping', async () => {
    jest.mocked(prisma.documentBrandExtraction.updateMany)
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    await service.enqueue({
      extractionId: 'extraction-1',
      legalEntityId: 'entity-1',
      tenantId: 'tenant-1',
      expectedAttemptCount: 0,
    });

    expect(prisma.documentBrandExtraction.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          state: { in: ['RUNNING', 'SUCCEEDED', 'FAILED'] },
          attempt_count: 1,
          dispatched_at: null,
        }),
      }),
    );
  });

  it('leaves dispatch fields untouched when enqueue fails', async () => {
    jest
      .mocked(cloudTasks.enqueueDocumentBrandingExtraction)
      .mockRejectedValueOnce(new Error('Cloud Tasks unavailable'));

    await expect(
      service.enqueue({
        extractionId: 'extraction-1',
        legalEntityId: 'entity-1',
        tenantId: 'tenant-1',
        expectedAttemptCount: 0,
      }),
    ).rejects.toThrow('Cloud Tasks unavailable');

    expect(prisma.documentBrandExtraction.updateMany).not.toHaveBeenCalled();
  });
});
