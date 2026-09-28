import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
const SWAGGER_API_RESPONSE = 'swagger/apiResponse';
import {
  parsePaginationParams,
  WorkshopController,
} from './workshop.controller.js';
import { WorkshopHolidayController } from './workshop-holidays.controller.js';
import { WorkshopSettingsController } from './workshop-settings.controller.js';
import { WorkshopPlannerController } from './workshop-planner.controller.js';
import { WorkshopBoardService } from './workshop-board.service.js';
import { WorkshopCatalogLineService } from './workshop-catalog-line.service.js';
import { WorkshopHolidayService } from './workshop-holiday.service.js';
import { WorkshopIntakeService } from './workshop-intake.service.js';
import { WorkshopInvoiceService } from './workshop-invoice.service.js';
import { WorkshopPdfService } from './workshop-pdf.service.js';
import { WorkshopPickPartsService } from './workshop-pick-parts.service.js';
import { WorkshopPlannerService } from './workshop-planner.service.js';
import { WorkshopSettingsService } from './workshop-settings.service.js';
import { WorkshopTaskService } from './workshop-task.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PickWorkshopPartsResponseDto } from './dto/pick-workshop-parts-response.dto.js';
import { AddWorkshopTaskLineFromCatalogResponseDto } from './dto/workshop-catalog-line-response.dto.js';

describe('WorkshopController', () => {
  let controller: WorkshopController;

  const mockIntakeService = {
    findAll: jest.fn(),
  };
  const mockTaskService = {};
  const mockCatalogLineService = {};
  const mockPickPartsService = {};
  const mockBoardService = {};
  const mockInvoiceService = {};
  const mockPdfService = {
    requestGeneration: jest.fn(),
  };

  const originalTargetBaseUrl = process.env.CLOUD_TASKS_TARGET_BASE_URL;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkshopController,
        { provide: WorkshopIntakeService, useValue: mockIntakeService },
        { provide: WorkshopTaskService, useValue: mockTaskService },
        {
          provide: WorkshopCatalogLineService,
          useValue: mockCatalogLineService,
        },
        { provide: WorkshopPickPartsService, useValue: mockPickPartsService },
        { provide: WorkshopBoardService, useValue: mockBoardService },
        { provide: WorkshopInvoiceService, useValue: mockInvoiceService },
        { provide: WorkshopPdfService, useValue: mockPdfService },
        { provide: WorkshopSettingsService, useValue: {} },
        { provide: WorkshopHolidayService, useValue: {} },
        { provide: WorkshopPlannerService, useValue: {} },
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

  it('registers the token-only catalog line route with a 200 response', () => {
    const routePath = Reflect.getMetadata(
      PATH_METADATA,
      controller.addTaskLineFromCatalog,
    );
    const routeMethod = Reflect.getMetadata(
      METHOD_METADATA,
      controller.addTaskLineFromCatalog,
    );
    const responses = Reflect.getMetadata(
      SWAGGER_API_RESPONSE,
      controller.addTaskLineFromCatalog,
    ) as Record<string, { type?: unknown }>;

    expect(routePath).toBe('orders/:id/tasks/:taskId/lines/from-catalog');
    expect(routeMethod).toBe(RequestMethod.POST);
    expect(responses?.['200']?.type).toBe(
      AddWorkshopTaskLineFromCatalogResponseDto,
    );
    expect(responses?.['401']).toBeDefined();
    expect(responses?.['409']).toBeDefined();
  });

  it('delegates findAll to intakeService with parsed pagination', () => {
    mockIntakeService.findAll.mockReturnValue({ data: [], meta: {} });
    const result = controller.findAll({
      search: 'oil',
      page: '2',
      pageSize: '25',
      sortField: 'createdAt',
      sortDirection: 'desc',
    });

    expect(mockIntakeService.findAll).toHaveBeenCalledWith({
      search: 'oil',
      page: 2,
      pageSize: 25,
      sortField: 'createdAt',
      sortDirection: 'desc',
    });
    expect(result).toEqual({ data: [], meta: {} });
  });

  describe('parsePaginationParams', () => {
    it('parses valid positive integer page and pageSize', () => {
      expect(parsePaginationParams('1', '20')).toEqual({
        page: 1,
        pageSize: 20,
      });
      expect(parsePaginationParams(undefined, undefined)).toEqual({
        page: undefined,
        pageSize: undefined,
      });
    });

    it('throws BadRequestException for invalid page or pageSize', () => {
      expect(() => parsePaginationParams('0', '10')).toThrow(
        BadRequestException,
      );
      expect(() => parsePaginationParams('-1', '10')).toThrow(
        BadRequestException,
      );
      expect(() => parsePaginationParams('abc', '10')).toThrow(
        BadRequestException,
      );
      expect(() => parsePaginationParams('1', '0')).toThrow(
        BadRequestException,
      );
      expect(() => parsePaginationParams('1', 'xyz')).toThrow(
        BadRequestException,
      );
    });
  });
});

describe('WorkshopHolidayController', () => {
  let controller: WorkshopHolidayController;
  const mockHolidayService = {
    listHolidays: jest.fn(),
    createHoliday: jest.fn(),
    importPublicHolidays: jest.fn(),
    updateHoliday: jest.fn(),
    deleteHoliday: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkshopHolidayController],
      providers: [
        { provide: WorkshopHolidayService, useValue: mockHolidayService },
      ],
    }).compile();

    controller = module.get(WorkshopHolidayController);
    jest.clearAllMocks();
  });

  it('delegates listHolidays, create, import, update, and delete', async () => {
    mockHolidayService.listHolidays.mockResolvedValue([]);
    await controller.listHolidays({ from: '2026-01-01', to: '2026-12-31' });
    expect(mockHolidayService.listHolidays).toHaveBeenCalledWith(
      '2026-01-01',
      '2026-12-31',
    );

    mockHolidayService.createHoliday.mockResolvedValue({ id: 'h-1' });
    await controller.createHoliday({ name: 'New Year', date: '2026-01-01' } as any);
    expect(mockHolidayService.createHoliday).toHaveBeenCalled();

    mockHolidayService.importPublicHolidays.mockResolvedValue({ imported: 1 });
    await controller.importHolidays({ countryCode: 'DE', year: 2026 } as any);
    expect(mockHolidayService.importPublicHolidays).toHaveBeenCalled();

    mockHolidayService.updateHoliday.mockResolvedValue({ id: 'h-1' });
    await controller.updateHoliday('11111111-1111-1111-1111-111111111111', { name: 'Updated' } as any);
    expect(mockHolidayService.updateHoliday).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
      { name: 'Updated' },
    );

    mockHolidayService.deleteHoliday.mockResolvedValue(undefined);
    await controller.deleteHoliday('11111111-1111-1111-1111-111111111111');
    expect(mockHolidayService.deleteHoliday).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
    );
  });
});

describe('WorkshopSettingsController', () => {
  let controller: WorkshopSettingsController;
  const mockSettingsService = {
    getSettings: jest.fn(),
    updateSettings: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkshopSettingsController],
      providers: [
        { provide: WorkshopSettingsService, useValue: mockSettingsService },
      ],
    }).compile();

    controller = module.get(WorkshopSettingsController);
    jest.clearAllMocks();
  });

  it('delegates getSettings and updateSettings', async () => {
    mockSettingsService.getSettings.mockResolvedValue({ id: 's-1' });
    await controller.getSettings();
    expect(mockSettingsService.getSettings).toHaveBeenCalled();

    mockSettingsService.updateSettings.mockResolvedValue({ id: 's-1' });
    await controller.updateSettings({} as any);
    expect(mockSettingsService.updateSettings).toHaveBeenCalled();
  });
});

describe('WorkshopPlannerController', () => {
  let controller: WorkshopPlannerController;
  const mockPlannerService = {
    getPlanner: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkshopPlannerController],
      providers: [
        { provide: WorkshopPlannerService, useValue: mockPlannerService },
      ],
    }).compile();

    controller = module.get(WorkshopPlannerController);
    jest.clearAllMocks();
  });

  it('delegates getPlanner', async () => {
    mockPlannerService.getPlanner.mockResolvedValue({ grid: [] });
    await controller.getPlanner({} as any);
    expect(mockPlannerService.getPlanner).toHaveBeenCalled();
  });
});
