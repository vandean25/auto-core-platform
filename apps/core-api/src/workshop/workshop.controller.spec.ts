import { Test, TestingModule } from '@nestjs/testing';
import { WorkshopController } from './workshop.controller';
import { WorkshopPdfService } from './workshop-pdf.service';
import { WorkshopService } from './workshop.service';

describe('WorkshopController', () => {
  let controller: WorkshopController;

  const mockWorkshopService = {};
  const mockPdfService = {
    requestGeneration: jest.fn(),
  };

  const originalTargetBaseUrl = process.env.CLOUD_TASKS_TARGET_BASE_URL;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkshopController,
        { provide: WorkshopService, useValue: mockWorkshopService },
        { provide: WorkshopPdfService, useValue: mockPdfService },
      ],
    }).compile();

    controller = module.get(WorkshopController);
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (originalTargetBaseUrl === undefined) {
      delete process.env.CLOUD_TASKS_TARGET_BASE_URL;
    } else {
      process.env.CLOUD_TASKS_TARGET_BASE_URL = originalTargetBaseUrl;
    }
  });

  it('uses the configured Cloud Tasks base URL for workshop PDF generation', async () => {
    process.env.CLOUD_TASKS_TARGET_BASE_URL = 'https://app.example.com/api';
    mockPdfService.requestGeneration.mockResolvedValue({
      mode: 'enqueued',
      taskId: 'task-1',
    });

    await expect(
      controller.generatePdf('11111111-1111-1111-1111-111111111111'),
    ).resolves.toEqual({
      message: 'PDF generation enqueued',
      enqueued: true,
      taskId: 'task-1',
    });

    expect(mockPdfService.requestGeneration).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
      { targetBaseUrl: 'https://app.example.com/api' },
    );
  });
});
