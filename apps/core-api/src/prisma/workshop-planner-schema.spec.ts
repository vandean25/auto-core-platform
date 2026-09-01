import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Workshop planner Prisma schema', () => {
  const schema = readFileSync(
    join(process.cwd(), 'prisma', 'schema.prisma'),
    'utf8',
  );

  it('defines site-owned planner settings and holiday source enum', () => {
    expect(schema).toContain('enum WorkshopHolidaySource');
    expect(schema).toContain('model Site');
    expect(schema).toContain('model WorkshopOpeningHour');
    expect(schema).toContain('model WorkshopHoliday');
    expect(schema).toContain('scheduled_start_at');
    expect(schema).toContain('scheduled_end_at');
    expect(schema).toContain('idx_workshop_orders_bay_schedule');
    expect(schema).toContain('@@map("sites")');
    expect(schema).toContain('@@map("workshop_opening_hours")');
    expect(schema).toContain('@@map("workshop_holidays")');
  });

  it('moves planner fields onto Site instead of a tenant singleton', () => {
    expect(schema).not.toContain('model WorkshopSettings');
    expect(schema).toContain('timezone                 String                @default("Europe/Vienna")');
    expect(schema).toContain('slot_minutes             Int                   @default(30)');
    expect(schema).toContain('holiday_country_iso      String                @default("AT")');
  });
});
