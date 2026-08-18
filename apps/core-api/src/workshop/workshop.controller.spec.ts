import { Test, TestingModule } from '@nestjs/testing';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
const SWAGGER_API_RESPONSE = 'swagger/apiResponse';
import { WorkshopController } from './workshop.controller';
import { WorkshopPdfService } from './workshop-pdf.service';
import { WorkshopService } from './workshop.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PickWorkshopPartsResponseDto } from './dto/pick-workshop-parts-response.dto';

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
        {
          provide: TenantContextService,
          useValue: { setTenantIdForWorker: jest.fn() },
        },
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

  it('registers pick-parts route under workshop orders path', () => {
    const routePath = Reflect.getMetadata(PATH_METADATA, controller.pickParts);
    const routeMethod = Reflect.getMetadata(
      METHOD_METADATA,
      controller.pickParts,
    );

    expect(routePath).toBe('orders/:id/pick-parts');
    expect(routeMethod).toBe(RequestMethod.POST);
  });

  it('documents pick-parts response schema in Swagger metadata', () => {
    const responses = Reflect.getMetadata(
      SWAGGER_API_RESPONSE,
      controller.pickParts,
    ) as Record<string, { type?: unknown }>;

    expect(responses?.['201']?.type).toBe(PickWorkshopPartsResponseDto);
  });
});
