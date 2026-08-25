import { WorkshopHoliday, WorkshopOpeningHour } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
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

function createEmployeeSchedule() {
  return [
    {
      id: 'sched-1',
      tenant_id: 't1',
      employee_id: 'emp-1',
      effective_from: new Date('2020-01-01T00:00:00.000Z'),
      days: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        id: `day-${weekday}`,
        tenant_id: 't1',
        schedule_id: 'sched-1',
        weekday,
        is_working: weekday <= 5,
        start_time: weekday <= 5 ? '08:00' : null,
        end_time: weekday <= 5 ? '17:00' : null,
        break_minutes: 0,
      })),
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
    employeeWorkSchedule: { findMany: jest.fn() },
  };
  const mockSettingsService = {
    getOrCreateSettings: jest.fn(),
  };
  const mockScheduleService = {};

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.employeeWorkSchedule.findMany.mockResolvedValue(
      createEmployeeSchedule(),
    );
    service = new HrWorkdayService(
      mockPrisma as any,
      mockSettingsService as any,
      mockScheduleService as any,
    );
  });

  describe('countChargeableMinutes', () => {
    it('rejects a range without a resolved employee schedule', async () => {
      mockPrisma.employeeWorkSchedule.findMany.mockResolvedValue([]);

      await expect(
        service.countChargeableMinutes(
          't1',
          'emp-1',
          '2026-08-24',
          '2026-08-24',
          'Europe/Vienna',
          createOpeningHours(),
          [],
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a working schedule day whose end is not after its start', async () => {
      mockPrisma.employeeWorkSchedule.findMany.mockResolvedValue([
        {
          ...createEmployeeSchedule()[0],
          days: createEmployeeSchedule()[0].days.map((day) =>
            day.weekday === 1
              ? { ...day, start_time: '17:00', end_time: '08:00' }
              : day,
          ),
        },
      ]);

      await expect(
        service.countChargeableMinutes(
          't1',
          'emp-1',
          '2026-08-24',
          '2026-08-24',
          'Europe/Vienna',
          createOpeningHours(),
          [],
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a schedule that is missing the date weekday row', async () => {
      mockPrisma.employeeWorkSchedule.findMany.mockResolvedValue([
        {
          ...createEmployeeSchedule()[0],
          days: createEmployeeSchedule()[0].days.filter(
            (day) => day.weekday !== 1,
          ),
        },
      ]);

      await expect(
        service.countChargeableMinutes(
          't1',
          'emp-1',
          '2026-08-24',
          '2026-08-24',
          'Europe/Vienna',
          createOpeningHours(),
          [],
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects malformed schedule time strings', async () => {
      mockPrisma.employeeWorkSchedule.findMany.mockResolvedValue([
        {
          ...createEmployeeSchedule()[0],
          days: createEmployeeSchedule()[0].days.map((day) =>
            day.weekday === 1 ? { ...day, start_time: 'invalid' } : day,
          ),
        },
      ]);

      await expect(
        service.countChargeableMinutes(
          't1',
          'emp-1',
          '2026-08-24',
          '2026-08-24',
          'Europe/Vienna',
          createOpeningHours(),
          [],
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('uses the schedule version effective on each date', async () => {
      const earlierSchedule = createEmployeeSchedule()[0];
      const laterSchedule = {
        ...earlierSchedule,
        id: 'sched-2',
        effective_from: new Date('2026-08-26T00:00:00.000Z'),
        days: earlierSchedule.days.map((day) => ({
          ...day,
          start_time: day.is_working ? '08:00' : null,
          end_time: day.is_working ? '16:00' : null,
        })),
      };
      mockPrisma.employeeWorkSchedule.findMany.mockResolvedValue([
        earlierSchedule,
        laterSchedule,
      ]);

      const minutesBeforeChange = await service.countChargeableMinutes(
        't1',
        'emp-1',
        '2026-08-24',
        '2026-08-24',
        'Europe/Vienna',
        createOpeningHours(),
        [],
      );
      const minutesAfterChange = await service.countChargeableMinutes(
        't1',
        'emp-1',
        '2026-08-31',
        '2026-08-31',
        'Europe/Vienna',
        createOpeningHours(),
        [],
      );

      expect(minutesBeforeChange).toBe(540);
      expect(minutesAfterChange).toBe(480);
    });

    it('skips closed Saturday and Sunday', async () => {
      const hours = createOpeningHours();
      // 2026-08-24 is Mon, 2026-08-30 is Sun
      const minutes = await service.countChargeableMinutes(
        't1',
        'emp-1',
        '2026-08-24',
        '2026-08-30',
        'Europe/Vienna',
        hours,
        [],
      );
      expect(minutes).toBe(2700);
    });

    it('skips closed WorkshopHoliday', async () => {
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
      const minutes = await service.countChargeableMinutes(
        't1',
        'emp-1',
        '2026-08-24',
        '2026-08-28',
        'Europe/Vienna',
        hours,
        holidays,
      );
      expect(minutes).toBe(2160);
    });

    it('charges a short holiday with reduced hours as full schedule minutes', async () => {
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
      const minutes = await service.countChargeableMinutes(
        't1',
        'emp-1',
        '2026-12-24',
        '2026-12-24',
        'Europe/Vienna',
        hours,
        holidays,
      );
      expect(minutes).toBe(540);
    });

    it('handles annual repeating holiday properly', async () => {
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
      const minutes = await service.countChargeableMinutes(
        't1',
        'emp-1',
        '2026-01-01',
        '2026-01-02',
        'Europe/Vienna',
        hours,
        holidays,
      );
      expect(minutes).toBe(540);
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
