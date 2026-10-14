import { HrWorkScheduleSeeder } from './hr-work-schedule-seeder.service.js';
import { createSchedule } from './hr-work-schedule.spec.support.js';

describe('HrWorkScheduleSeeder', () => {
  const settingsService = { getOrCreateSettings: jest.fn() };
  let transaction: { employeeWorkSchedule: { create: jest.Mock } };
  let seeder: HrWorkScheduleSeeder;

  beforeEach(() => {
    jest.clearAllMocks();
    transaction = {
      employeeWorkSchedule: {
        create: jest.fn().mockResolvedValue(createSchedule()),
      },
    };
    seeder = new HrWorkScheduleSeeder(settingsService as never);
  });

  it('seeds the schedule from the workshop opening hours inside the caller transaction', async () => {
    settingsService.getOrCreateSettings.mockResolvedValue({
      timezone: 'Europe/Vienna',
      openingHours: [
        {
          id: 'hour-1',
          tenant_id: 'tenant-1',
          weekday: 1,
          is_closed: false,
          open_time: '08:00',
          close_time: '18:00',
        },
      ],
    });

    await seeder.seedInitialSchedule(
      transaction as never,
      'tenant-1',
      'employee-1',
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(settingsService.getOrCreateSettings).toHaveBeenCalledWith(
      'tenant-1',
    );
    expect(transaction.employeeWorkSchedule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenant_id: 'tenant-1',
          employee_id: 'employee-1',
          effective_from: new Date('2026-01-01T00:00:00.000Z'),
          days: {
            create: expect.arrayContaining([
              expect.objectContaining({
                weekday: 1,
                is_working: true,
                start_time: '08:00',
                end_time: '18:00',
              }),
            ]),
          },
        }),
      }),
    );
  });

  it('seeds closed days when the workshop has no opening hours', async () => {
    settingsService.getOrCreateSettings.mockResolvedValue({
      timezone: 'Europe/Vienna',
      openingHours: [],
    });

    await seeder.seedInitialSchedule(
      transaction as never,
      'tenant-1',
      'employee-1',
      new Date('2026-01-01T00:00:00.000Z'),
    );

    const data = transaction.employeeWorkSchedule.create.mock.calls[0][0].data;
    expect(data.days.create).toHaveLength(7);
    expect(
      data.days.create.every((day: { is_working: boolean }) => !day.is_working),
    ).toBe(true);
  });
});
