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
    expect(schema).toContain('annual_leave_days');
    expect(schema).toContain('@@map("employee_leave_balances")');
    expect(schema).toContain('@@map("leave_requests")');
    expect(schema).toContain('@@map("attendance_events")');
    expect(schema).toContain('@@unique([tenant_id, employee_id, year])');
  });
});
