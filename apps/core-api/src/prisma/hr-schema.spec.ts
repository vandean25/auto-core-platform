import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('HR Prisma schema', () => {
  const schema = readFileSync(
    join(process.cwd(), 'prisma', 'schema.prisma'),
    'utf8',
  );

  it('defines attendance, leave, and employee HR columns', () => {
    expect(schema).toContain('enum AttendanceEventType');
    expect(schema).toContain('enum AttendanceEventSource');
    expect(schema).toContain('enum LeaveRequestStatus');
    expect(schema).toContain('model EmployeeLeaveBalance');
    expect(schema).toContain('model LeaveRequest');
    expect(schema).toContain('model AttendanceEvent');
    expect(schema).toContain('hired_on');
    expect(schema).toContain('annual_leave_minutes');
    expect(schema).toContain('model EmployeeWorkSchedule');
    expect(schema).toContain('model EmployeeWorkScheduleDay');
    expect(schema).toContain('minutes_charged');
    expect(schema).toContain('@@map("employee_leave_balances")');
    expect(schema).toContain('@@map("leave_requests")');
    expect(schema).toContain('@@map("attendance_events")');
    expect(schema).toContain('@@unique([tenant_id, employee_id, year])');
  });

  it('does not retain day-based leave columns or a 25-day default', () => {
    expect(schema).not.toContain('annual_leave_days');
    expect(schema).not.toContain('allowance_days');
    expect(schema).not.toContain('carryover_days');
    expect(schema).not.toContain('days_charged');
    expect(schema).not.toMatch(
      /annual_leave_minutes\s+Int\s+@default\(25\)/,
    );
  });

  it('enforces ADR-0013 tenant isolation on work schedules', () => {
    expect(schema).toContain('@@unique([tenant_id, id])');
    expect(schema).toContain(
      '@@unique([tenant_id, employee_id, effective_from])',
    );
    expect(schema).toContain(
      '@@unique([tenant_id, schedule_id, weekday])',
    );
    expect(schema).toContain(
      'employee       Employee                  @relation(fields: [tenant_id, employee_id], references: [tenant_id, id], onDelete: Cascade)',
    );
    expect(schema).toContain(
      'schedule      EmployeeWorkSchedule @relation(fields: [tenant_id, schedule_id], references: [tenant_id, id], onDelete: Cascade)',
    );
    expect(schema).toContain('@@map("employee_work_schedules")');
    expect(schema).toContain('@@map("employee_work_schedule_days")');
  });
});
