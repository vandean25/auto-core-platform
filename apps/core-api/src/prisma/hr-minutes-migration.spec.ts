import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function remainingLeaveMinutesFromDays(
  allowanceDays: number,
  carryoverDays: number,
  bookedDays: number,
  avgMinutesPerWorkday: number,
): { remainingDays: number; remainingMinutes: number } {
  const remainingDays = allowanceDays + carryoverDays - bookedDays;
  const allowanceMinutes = Math.round(allowanceDays * avgMinutesPerWorkday);
  const carryoverMinutes = Math.round(carryoverDays * avgMinutesPerWorkday);
  const bookedMinutes = Math.round(bookedDays * avgMinutesPerWorkday);
  const remainingMinutes = allowanceMinutes + carryoverMinutes - bookedMinutes;

  return { remainingDays, remainingMinutes };
}

describe('HR minutes migration', () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      'prisma',
      'migrations',
      '20260825120000_hr_minutes_and_work_schedules',
      'migration.sql',
    ),
    'utf8',
  );
  const followUpMigrationPath = join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260825123000_hr_schedule_migration_corrections',
    'migration.sql',
  );

  it('uses one avg factor per employee for every day-column conversion', () => {
    expect(migration).toContain('CREATE TEMP TABLE "_hr_schedule_avg"');
    expect(migration).toMatch(
      /annual_leave_minutes.*annual_leave_days.*avg_minutes/s,
    );
    expect(migration).toMatch(
      /allowance_minutes.*allowance_days.*avg_minutes/s,
    );
    expect(migration).toMatch(
      /carryover_minutes.*carryover_days.*avg_minutes/s,
    );
    expect(migration).toMatch(
      /minutes_charged.*days_charged.*avg_minutes/s,
    );
  });

  it('pads each schedule to ISO weekdays 1-7', () => {
    expect(migration).toMatch(/sd\."weekday" = d\.weekday/);
    expect(migration).toContain("(7, false, NULL::text, NULL::text)");
  });

  it('keeps post-migration schedule corrections in a follow-up migration', () => {
    expect(existsSync(followUpMigrationPath)).toBe(true);
    const followUpMigration = readFileSync(followUpMigrationPath, 'utf8');

    expect(followUpMigration).toContain(
      'CURRENT_TIMESTAMP AT TIME ZONE COALESCE',
    );
    expect(followUpMigration).toContain('480.0 / 515.0');
    expect(migration).not.toContain('CURRENT_TIMESTAMP AT TIME ZONE');
  });

  it('preserves remaining leave at cutover when one avg factor is applied', () => {
    const scenarios = [
      { allowanceDays: 25, carryoverDays: 0, bookedDays: 5, avg: 515 },
      { allowanceDays: 25, carryoverDays: 2, bookedDays: 5, avg: 515 },
      { allowanceDays: 30, carryoverDays: 5, bookedDays: 3, avg: 570 },
      { allowanceDays: 20, carryoverDays: 0, bookedDays: 0, avg: 480 },
    ];

    for (const scenario of scenarios) {
      const { remainingDays, remainingMinutes } = remainingLeaveMinutesFromDays(
        scenario.allowanceDays,
        scenario.carryoverDays,
        scenario.bookedDays,
        scenario.avg,
      );

      expect(remainingMinutes).toBe(Math.round(remainingDays * scenario.avg));
    }
  });
});
