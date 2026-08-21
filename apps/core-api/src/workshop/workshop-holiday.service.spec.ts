import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { WorkshopHolidayService } from './workshop-holiday.service';
import { WorkshopSettingsService } from './workshop-settings.service';
import {
  mockPrisma,
  mockTenantContext,
  resetWorkshopMocks,
  workshopPrismaProvider,
  workshopTenantProvider,
} from './workshop.spec.support';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const SETTINGS_ID = 'ws-1';

const adminUser = {
  userId: 'u-1',
  email: 'admin@example.com',
  tenantId: TENANT_ID,
  role: 'ADMIN',
};

const settings = {
  id: SETTINGS_ID,
  tenant_id: TENANT_ID,
  timezone: 'Europe/Vienna',
  slot_minutes: 30,
  holiday_country_iso: 'AT',
  holiday_subdivision_code: null,
  openingHours: [],
};

describe('WorkshopHolidayService', () => {
  let service: WorkshopHolidayService;
  const settingsService = {
    getOrCreateSettings: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkshopHolidayService,
        workshopPrismaProvider,
        workshopTenantProvider,
        { provide: WorkshopSettingsService, useValue: settingsService },
      ],
    }).compile();

    service = module.get(WorkshopHolidayService);
    resetWorkshopMocks();
    mockTenantContext.getTenantId.mockResolvedValue(TENANT_ID);
    mockTenantContext.getAuthenticatedUser.mockReturnValue(adminUser);
    settingsService.getOrCreateSettings.mockResolvedValue(settings);
    mockPrisma.workshopHoliday.findMany.mockResolvedValue([]);
  });

  it('creates a closed manual holiday', async () => {
    mockPrisma.workshopHoliday.create.mockResolvedValue({
      id: 'h-1',
      name: 'Betriebsurlaub',
      observed_on: new Date('2026-12-24T00:00:00.000Z'),
      repeats_annually: false,
      is_closed: true,
      open_time: null,
      close_time: null,
      source: 'MANUAL',
    });

    const result = await service.createHoliday({
      name: 'Betriebsurlaub',
      observedOn: '2026-12-24',
      isClosed: true,
    });

    expect(result.source).toBe('MANUAL');
    expect(result.repeatsAnnually).toBe(false);
    expect(result.observedOn).toBe('2026-12-24');
    expect(mockPrisma.workshopHoliday.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workshop_settings_id: SETTINGS_ID,
          is_closed: true,
          source: 'MANUAL',
        }),
      }),
    );
  });

  it('rejects a short day without open and close times', async () => {
    await expect(
      service.createHoliday({
        name: 'Christmas Eve',
        observedOn: '2026-12-24',
        isClosed: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a one-off that collides with an existing one-off date', async () => {
    mockPrisma.workshopHoliday.findMany.mockResolvedValue([
      {
        id: 'h-existing',
        observed_on: new Date('2026-12-24T00:00:00.000Z'),
        repeats_annually: false,
      },
    ]);

    await expect(
      service.createHoliday({
        name: 'Duplicate',
        observedOn: '2026-12-24',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an annual holiday that collides with a one-off month-day', async () => {
    mockPrisma.workshopHoliday.findMany.mockResolvedValue([
      {
        id: 'h-existing',
        observed_on: new Date('2026-12-25T00:00:00.000Z'),
        repeats_annually: false,
      },
    ]);

    await expect(
      service.createHoliday({
        name: 'Christmas',
        observedOn: '2020-12-25',
        repeatsAnnually: true,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an annual holiday that collides with another annual month-day', async () => {
    mockPrisma.workshopHoliday.findMany.mockResolvedValue([
      {
        id: 'h-existing',
        observed_on: new Date('2020-12-25T00:00:00.000Z'),
        repeats_annually: true,
      },
    ]);

    await expect(
      service.createHoliday({
        name: 'Weihnachten',
        observedOn: '2026-12-25',
        repeatsAnnually: true,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('deletes a holiday for this tenant', async () => {
    mockPrisma.workshopHoliday.deleteMany.mockResolvedValue({ count: 1 });

    await service.deleteHoliday('h-1');

    expect(mockPrisma.workshopHoliday.deleteMany).toHaveBeenCalledWith({
      where: { id: 'h-1', tenant_id: TENANT_ID },
    });
  });

  it('forbids SALES from creating holidays', async () => {
    mockTenantContext.getAuthenticatedUser.mockReturnValue({
      ...adminUser,
      role: 'SALES',
    });

    await expect(
      service.createHoliday({
        name: 'Betriebsurlaub',
        observedOn: '2026-12-24',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
