import type { EmployeeWorkScheduleDay } from '@prisma/client';

export type ScheduleDayInput = Pick<
  EmployeeWorkScheduleDay,
  'weekday' | 'is_working' | 'start_time' | 'end_time' | 'break_minutes'
>;

export type ScheduleWithDays = {
  id: string;
  site_id: string | null;
  effective_from: Date;
  days: EmployeeWorkScheduleDay[];
  createdAt: Date;
  updatedAt: Date;
};
