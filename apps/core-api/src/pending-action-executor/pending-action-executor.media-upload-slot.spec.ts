import { PendingActionExecutorService } from './pending-action-executor.service.js';

describe('PendingActionExecutorService workshop.media_upload_slot', () => {
  const mockWorkshopMediaUploadMcp = {
    createUploadSlot: jest.fn().mockResolvedValue({
      id: 'media-1',
      entityId: 'media-1',
      media_id: 'media-1',
      upload_url: 'https://storage.example/upload',
      fields: { key: 'object-key' },
      expires_at: '2026-10-17T12:00:00.000Z',
    }),
  };

  let service: PendingActionExecutorService;

  beforeEach(() => {
    service = new PendingActionExecutorService(
      { site: { updateMany: jest.fn() } } as never,
      { getTenantId: jest.fn() } as never,
      { getSiteId: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      mockWorkshopMediaUploadMcp as never,
      {} as never,
      {} as never,
    );
  });

  it('delegates to workshop media upload MCP service', async () => {
    const executor = service.resolve('workshop.media_upload_slot');
    const result = await executor.execute({
      workshop_task_id: '00000000-0000-4000-8000-000000000006',
      mime_type: 'image/jpeg',
      size_bytes: 1024,
      purpose: 'MECHANIC_FINDING',
    });
    expect(mockWorkshopMediaUploadMcp.createUploadSlot).toHaveBeenCalled();
    expect(result).toMatchObject({ media_id: 'media-1' });
  });
});
