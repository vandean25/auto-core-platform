import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { WorkshopSettingsService } from './workshop-settings.service';
import {
  mockPrisma,
  mockTenantContext,
  resetWorkshopMocks,
  workshopPrismaProvider,
  workshopTenantProvider,
} from './workshop.spec.support';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

const DEFAULT_OPENING_HOURS = [
  { weekday: 1, isClosed: false, openTime: '07:30', closeTime: '17:00' },
  { weekday: 2, isClosed: false, openTime: '07:30', closeTime: '17:00' },
  { weekday: 3, isClosed: false, openTime: '07:30', closeTime: '17:00' },
  { weekday: 4, isClosed: false, openTime: '07:30', closeTime: '17:00' },
  { weekday: 5, isClosed: false, openTime: '07:30', closeTime: '17:00' },
  { weekday: 6, isClosed: false, openTime: '08:00', closeTime: '12:00' },
  { weekday: 7, isClosed: true, openTime: '07:30', closeTime: '17:00' },
] as const;

const adminUser = {
  userId: 'u-1',
  email: 'admin@example.com',
  tenantId: TENANT_ID,
  role: 'ADMIN',
};

function openingHoursPayload(
  overrides: Partial<(typeof DEFAULT_OPENING_HOURS)[number]>[] = [],
) {
  return DEFAULT_OPENING_HOURS.map((row, index) => ({
    weekday: row.weekday,
    isClosed: row.isClosed,
    openTime: row.openTime,
    closeTime: row.closeTime,
    ...(overrides[index] ?? {}),
  }));
}

describe('WorkshopSettingsService', () => {
  let service: WorkshopSettingsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkshopSettingsService,
        workshopPrismaProvider,
        workshopTenantProvider,
      ],
    }).compile();

    service = module.get(WorkshopSettingsService);
    resetWorkshopMocks();
    mockTenantContext.getTenantId.mockResolvedValue(TENANT_ID);
    mockTenantContext.getAuthenticatedUser.mockReturnValue(adminUser);
  });

  it('seeds seven weekday hours when no site exists', async () => {
    mockPrisma.site.findFirst.mockResolvedValueOnce(null);
    mockPrisma.tenant.findFirst.mockResolvedValue({
      name: 'Test Tenant',
    });
    mockPrisma.legalEntity.create.mockResolvedValue({
      id: 'le-1',
      tenant_id: TENANT_ID,
    });
    mockPrisma.site.create.mockResolvedValue({
      id: 'site-1',
      tenant_id: TENANT_ID,
      legal_entity_id: 'le-1',
    });
    mockPrisma.workshopOpeningHour.createMany.mockResolvedValue({ count: 7 });
    mockPrisma.storageLocation.createMany.mockResolvedValue({ count: 2 });
    mockPrisma.site.findFirstOrThrow.mockResolvedValue({
      id: 'site-1',
      tenant_id: TENANT_ID,
      timezone: 'Europe/Vienna',
      slot_minutes: 30,
      holiday_country_iso: 'AT',
      holiday_subdivision_code: null,
      openingHours: DEFAULT_OPENING_HOURS.map((row, i) => ({
        id: `oh-${i}`,
        weekday: row.weekday,
        is_closed: row.isClosed,
        open_time: row.openTime,
        close_time: row.closeTime,
      })),
    });

    const result = await service.getSettings();

    expect(mockPrisma.site.create).toHaveBeenCalled();
    expect(mockPrisma.workshopOpeningHour.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ weekday: 6, open_time: '08:00' }),
          expect.objectContaining({ weekday: 7, is_closed: true }),
        ]),
      }),
    );
    expect(mockPrisma.storageLocation.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ code: 'TRANSIT', type: 'in_transit', is_system: true }),
          expect.objectContaining({ code: 'LOT', type: 'vehicle_lot' }),
        ]),
      }),
    );
    expect(result.openingHours).toHaveLength(7);
    expect(result.timezone).toBe('Europe/Vienna');
    expect(result.slotMinutes).toBe(30);
    expect(result.holidayCountryIso).toBe('AT');
  });

  it('rejects PUT when a weekday is missing', async () => {
    await expect(
      service.updateSettings({
        timezone: 'Europe/Vienna',
        slotMinutes: 30,
        holidayCountryIso: 'AT',
        holidaySubdivisionCode: null,
        openingHours: openingHoursPayload().slice(0, 6),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid slotMinutes', async () => {
    await expect(
      service.updateSettings({
        timezone: 'Europe/Vienna',
        slotMinutes: 20,
        holidayCountryIso: 'AT',
        holidaySubdivisionCode: null,
        openingHours: openingHoursPayload(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects closeTime at or before openTime on an open day', async () => {
    const hours = openingHoursPayload();
    hours[0] = {
      weekday: 1,
      isClosed: false,
      openTime: '17:00',
      closeTime: '17:00',
    };

    await expect(
      service.updateSettings({
        timezone: 'Europe/Vienna',
        slotMinutes: 30,
        holidayCountryIso: 'AT',
        holidaySubdivisionCode: null,
        openingHours: hours,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an invalid IANA timezone', async () => {
    await expect(
      service.updateSettings({
        timezone: 'Not/A_Zone',
        slotMinutes: 30,
        holidayCountryIso: 'AT',
        holidaySubdivisionCode: null,
        openingHours: openingHoursPayload(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('forbids SALES from writing settings', async () => {
    mockTenantContext.getAuthenticatedUser.mockReturnValue({
      ...adminUser,
      role: 'SALES',
    });

    await expect(
      service.updateSettings({
        timezone: 'Europe/Vienna',
        slotMinutes: 30,
        holidayCountryIso: 'AT',
        holidaySubdivisionCode: null,
        openingHours: openingHoursPayload(),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
