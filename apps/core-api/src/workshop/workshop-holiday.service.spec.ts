import { Test, TestingModule } from '@nestjs/testing';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { WorkshopHolidayService } from './workshop-holiday.service';
import { WorkshopSettingsService } from './workshop-settings.service';
import { OPENHOLIDAYS_FETCH } from './openholidays.client';
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
  const fetchMock = jest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkshopHolidayService,
        workshopPrismaProvider,
        workshopTenantProvider,
        { provide: WorkshopSettingsService, useValue: settingsService },
        { provide: OPENHOLIDAYS_FETCH, useValue: fetchMock },
      ],
    }).compile();

    service = module.get(WorkshopHolidayService);
    resetWorkshopMocks();
    mockTenantContext.getTenantId.mockResolvedValue(TENANT_ID);
    mockTenantContext.getAuthenticatedUser.mockReturnValue(adminUser);
    settingsService.getOrCreateSettings.mockResolvedValue(settings);
    mockPrisma.workshopHoliday.findMany.mockResolvedValue([]);
    fetchMock.mockReset();
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

  it('lists holidays for an explicit from/to window', async () => {
    mockPrisma.workshopHoliday.findMany.mockResolvedValue([]);

    await service.listHolidays('2026-01-01', '2027-12-31');

    expect(mockPrisma.workshopHoliday.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant_id: TENANT_ID,
          OR: expect.arrayContaining([
            expect.objectContaining({
              repeats_annually: false,
              observed_on: {
                gte: new Date('2026-01-01T00:00:00.000Z'),
                lte: new Date('2027-12-31T00:00:00.000Z'),
              },
            }),
          ]),
        }),
      }),
    );
  });

  it('rejects array from/to query values', async () => {
    await expect(
      service.listHolidays(
        ['2026-01-01', '2026-06-01'] as unknown as string,
        '2026-12-31',
      ),
    ).rejects.toMatchObject({
      message: 'from must be a single YYYY-MM-DD string',
    });
    expect(mockPrisma.workshopHoliday.findMany).not.toHaveBeenCalled();
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

  it('imports nationwide public days without overwriting MANUAL rows', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 'oh-1',
          startDate: '2026-01-01',
          endDate: '2026-01-01',
          type: 'Public',
          nationwide: true,
          name: [{ language: 'DE', text: 'Neujahr' }],
        },
        {
          id: 'oh-2',
          startDate: '2026-12-24',
          endDate: '2026-12-24',
          type: 'Public',
          nationwide: true,
          name: [{ language: 'DE', text: 'Heiliger Abend' }],
        },
      ],
    });
    mockPrisma.workshopHoliday.findMany.mockResolvedValue([
      {
        id: 'manual-1',
        observed_on: new Date('2026-12-24T00:00:00.000Z'),
        repeats_annually: false,
        source: 'MANUAL',
        name: 'Betriebsurlaub',
      },
    ]);
    mockPrisma.workshopHoliday.create.mockResolvedValue({
      id: 'imported-1',
    });

    const result = await service.importPublicHolidays({});

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(mockPrisma.workshopHoliday.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.workshopHoliday.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Neujahr',
          source: 'IMPORTED',
          repeats_annually: false,
          is_closed: true,
          external_id: 'oh-1',
        }),
      }),
    );
  });

  it('returns 502 when OpenHolidays times out', async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });

    jest.useFakeTimers();
    const pending = service.importPublicHolidays({});
    const assertion = expect(pending).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    await jest.advanceTimersByTimeAsync(3000);
    await assertion;
    jest.useRealTimers();
    expect(mockPrisma.workshopHoliday.create).not.toHaveBeenCalled();
  });
});
