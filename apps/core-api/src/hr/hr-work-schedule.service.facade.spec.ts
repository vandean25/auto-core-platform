import {
  HrWorkScheduleService,
  FALLBACK_AVG_WORKDAY_MINUTES,
} from './hr-work-schedule.service.js';

describe('HrWorkScheduleService facade', () => {
  const reader = {
    findForEmployee: jest.fn(),
    resolveScheduleForDate: jest.fn(),
    resolveCurrentSchedule: jest.fn(),
    getCurrentAverageWorkdayMinutes: jest.fn(),
  };
  const writer = {
    createForEmployee: jest.fn(),
    updateForEmployee: jest.fn(),
  };
  const seeder = { seedInitialSchedule: jest.fn() };
  let service: HrWorkScheduleService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new HrWorkScheduleService(
      reader as never,
      writer as never,
      seeder as never,
    );
  });

  it('delegates employee schedule reads to the reader', async () => {
    reader.findForEmployee.mockResolvedValue({ current: null, history: [] });

    await expect(service.findForEmployee('employee-1')).resolves.toEqual({
      current: null,
      history: [],
    });
    expect(reader.findForEmployee).toHaveBeenCalledWith('employee-1');
  });

  it('delegates create and update to the writer with the same arguments', async () => {
    const dto = { siteId: 'site-1', effectiveFrom: '2026-09-01', days: [] };
    writer.createForEmployee.mockResolvedValue({ id: 'schedule-2' });
    writer.updateForEmployee.mockResolvedValue({ id: 'schedule-1' });

    await expect(service.createForEmployee('employee-1', dto)).resolves.toEqual(
      { id: 'schedule-2' },
    );
    await expect(
      service.updateForEmployee('employee-1', 'schedule-1', dto),
    ).resolves.toEqual({ id: 'schedule-1' });

    expect(writer.createForEmployee).toHaveBeenCalledWith('employee-1', dto);
    expect(writer.updateForEmployee).toHaveBeenCalledWith(
      'employee-1',
      'schedule-1',
      dto,
    );
  });

  it('delegates initial seeding to the seeder with the caller transaction', async () => {
    const transaction = {} as never;
    const effectiveFrom = new Date('2026-01-01T00:00:00.000Z');

    await service.seedInitialSchedule(
      transaction,
      'tenant-1',
      'employee-1',
      effectiveFrom,
    );

    expect(seeder.seedInitialSchedule).toHaveBeenCalledWith(
      transaction,
      'tenant-1',
      'employee-1',
      effectiveFrom,
    );
  });

  it('delegates schedule resolution and average minutes to the reader', async () => {
    reader.resolveScheduleForDate.mockResolvedValue({ id: 'schedule-1' });
    reader.resolveCurrentSchedule.mockResolvedValue({ id: 'schedule-1' });
    reader.getCurrentAverageWorkdayMinutes.mockResolvedValue(570);

    await expect(
      service.resolveScheduleForDate('tenant-1', 'employee-1', '2026-05-01'),
    ).resolves.toEqual({ id: 'schedule-1' });
    await expect(
      service.resolveCurrentSchedule('tenant-1', 'employee-1', 'Europe/Vienna'),
    ).resolves.toEqual({ id: 'schedule-1' });
    await expect(
      service.getCurrentAverageWorkdayMinutes(
        'tenant-1',
        'employee-1',
        'Europe/Vienna',
      ),
    ).resolves.toBe(570);

    expect(reader.resolveScheduleForDate).toHaveBeenCalledWith(
      'tenant-1',
      'employee-1',
      '2026-05-01',
    );
    expect(reader.resolveCurrentSchedule).toHaveBeenCalledWith(
      'tenant-1',
      'employee-1',
      'Europe/Vienna',
    );
    expect(reader.getCurrentAverageWorkdayMinutes).toHaveBeenCalledWith(
      'tenant-1',
      'employee-1',
      'Europe/Vienna',
    );
  });

  it('computes the default annual leave from 25 days at the average workday', () => {
    expect(
      service.defaultAnnualLeaveMinutes(FALLBACK_AVG_WORKDAY_MINUTES),
    ).toBe(12000);
    expect(service.defaultAnnualLeaveMinutes(570)).toBe(14250);
  });

  it('maps opening hours to a full week of schedule days', () => {
    const days = service.mapOpeningHoursToScheduleDays([]);

    expect(days.map((day) => day.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
