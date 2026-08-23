import { WorkshopHoliday, WorkshopOpeningHour } from '@prisma/client';
import { HrWorkdayService } from './hr-workday.service';

function createOpeningHours(): WorkshopOpeningHour[] {
  return [
    {
      id: '1',
      tenant_id: 't1',
      workshop_settings_id: 's1',
      weekday: 1,
      is_closed: false,
      open_time: '08:00',
      close_time: '17:00',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: '2',
      tenant_id: 't1',
      workshop_settings_id: 's1',
      weekday: 2,
      is_closed: false,
      open_time: '08:00',
      close_time: '17:00',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: '3',
      tenant_id: 't1',
      workshop_settings_id: 's1',
      weekday: 3,
      is_closed: false,
      open_time: '08:00',
      close_time: '17:00',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: '4',
      tenant_id: 't1',
      workshop_settings_id: 's1',
      weekday: 4,
      is_closed: false,
      open_time: '08:00',
      close_time: '17:00',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: '5',
      tenant_id: 't1',
      workshop_settings_id: 's1',
      weekday: 5,
      is_closed: false,
      open_time: '08:00',
      close_time: '17:00',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: '6',
      tenant_id: 't1',
      workshop_settings_id: 's1',
      weekday: 6,
      is_closed: true,
      open_time: null,
      close_time: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: '7',
      tenant_id: 't1',
      workshop_settings_id: 's1',
      weekday: 7,
      is_closed: true,
      open_time: null,
      close_time: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
}

describe('HrWorkdayService', () => {
  let service: HrWorkdayService;
  const mockPrisma = {
    workshopSettings: { findFirst: jest.fn() },
    workshopHoliday: { findMany: jest.fn() },
  };
  const mockSettingsService = {
    getOrCreateSettings: jest.fn(),
  };

  beforeEach(() => {
    service = new HrWorkdayService(
      mockPrisma as any,
      mockSettingsService as any,
    );
  });

  describe('countChargeableDays', () => {
    it('skips closed Saturday and Sunday', () => {
      const hours = createOpeningHours();
      // 2026-08-24 is Mon, 2026-08-30 is Sun
      const count = service.countChargeableDays(
        '2026-08-24',
        '2026-08-30',
        'Europe/Vienna',
        hours,
        [],
      );
      expect(count).toBe(5); // Mon-Fri
    });

    it('skips closed WorkshopHoliday', () => {
      const hours = createOpeningHours();
      const holidays: WorkshopHoliday[] = [
        {
          id: 'h1',
          tenant_id: 't1',
          workshop_settings_id: 's1',
          name: 'National Holiday',
          observed_on: new Date('2026-08-26T00:00:00.000Z'),
          repeats_annually: false,
          is_closed: true,
          open_time: null,
          close_time: null,
          source: 'MANUAL',
          external_id: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      // 2026-08-24 (Mon) to 2026-08-28 (Fri)
      const count = service.countChargeableDays(
        '2026-08-24',
        '2026-08-28',
        'Europe/Vienna',
        hours,
        holidays,
      );
      expect(count).toBe(4); // Wed 26 skipped
    });

    it('charges a short holiday with reduced hours as 1 full day', () => {
      const hours = createOpeningHours();
      const holidays: WorkshopHoliday[] = [
        {
          id: 'h2',
          tenant_id: 't1',
          workshop_settings_id: 's1',
          name: 'Christmas Eve Half-Day',
          observed_on: new Date('2026-12-24T00:00:00.000Z'),
          repeats_annually: true,
          is_closed: false,
          open_time: '08:00',
          close_time: '12:00',
          source: 'MANUAL',
          external_id: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      const count = service.countChargeableDays(
        '2026-12-24',
        '2026-12-24',
        'Europe/Vienna',
        hours,
        holidays,
      );
      expect(count).toBe(1);
    });

    it('handles annual repeating holiday properly', () => {
      const hours = createOpeningHours();
      const holidays: WorkshopHoliday[] = [
        {
          id: 'h3',
          tenant_id: 't1',
          workshop_settings_id: 's1',
          name: 'New Year',
          observed_on: new Date('2020-01-01T00:00:00.000Z'),
          repeats_annually: true,
          is_closed: true,
          open_time: null,
          close_time: null,
          source: 'IMPORTED',
          external_id: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      // 2026-01-01 is a Thursday, 2026-01-02 is a Friday
      const count = service.countChargeableDays(
        '2026-01-01',
        '2026-01-02',
        'Europe/Vienna',
        hours,
        holidays,
      );
      expect(count).toBe(1); // 1 Jan closed, 2 Jan open
    });
  });

  describe('loadTenantCalendar', () => {
    it('loads settings and holidays from DB', async () => {
      mockSettingsService.getOrCreateSettings.mockResolvedValue({
        timezone: 'Europe/Vienna',
        openingHours: createOpeningHours(),
      });
      mockPrisma.workshopHoliday.findMany.mockResolvedValue([]);

      const result = await service.loadTenantCalendar('t1');
      expect(result.timezone).toBe('Europe/Vienna');
      expect(result.openingHours).toHaveLength(7);
      expect(mockPrisma.workshopHoliday.findMany).toHaveBeenCalledWith({
        where: { tenant_id: 't1' },
      });
    });
  });
});
