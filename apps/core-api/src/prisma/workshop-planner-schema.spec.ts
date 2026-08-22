import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Workshop planner Prisma schema', () => {
  const schema = readFileSync(
    join(process.cwd(), 'prisma', 'schema.prisma'),
    'utf8',
  );

  it('defines WorkshopSettings singleton and holiday source enum', () => {
    expect(schema).toContain('enum WorkshopHolidaySource');
    expect(schema).toContain('model WorkshopSettings');
    expect(schema).toContain('model WorkshopOpeningHour');
    expect(schema).toContain('model WorkshopHoliday');
    expect(schema).toContain('scheduled_start_at');
    expect(schema).toContain('scheduled_end_at');
    expect(schema).toContain('idx_workshop_orders_bay_schedule');
    expect(schema).toContain('@@map("workshop_settings")');
    expect(schema).toContain('@@map("workshop_opening_hours")');
    expect(schema).toContain('@@map("workshop_holidays")');
  });
});
