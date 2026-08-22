import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AttendanceEventSource, AttendanceEventType } from '@prisma/client';
import { chunkedPromiseAll } from '../common/utils/promise.util';
import { SystemPrismaService } from '../prisma/system-prisma.service';

/**
 * Nightly scheduled job that force-closes open/orphaned attendance shifts.
 *
 * Runs at 23:59 every day (ADR-0020 §4.2, Feature Spec ruling 13).
 * Sets type = CLOCK_OUT, source = AUTO_SHIFT_CLOSE, occurred_at = now.
 *
 * Uses `SystemPrismaService` (plain PrismaClient without the tenant-isolation
 * extension) because cron jobs run outside request context where
 * `TenantContextStorage` is unset, and this is an intentional cross-tenant
 * maintenance operation.
 */
@Injectable()
export class HrAttendanceSchedulerService {
  private readonly logger = new Logger(HrAttendanceSchedulerService.name);

  constructor(private readonly systemPrisma: SystemPrismaService) {}

  @Cron('59 23 * * *', { name: 'hr-shift-close' })
  async closeOrphanedShifts(now: Date = new Date()): Promise<void> {
    this.logger.log(
      'HR shift-close job started: querying latest attendance events.',
    );

    const events = await this.systemPrisma.attendanceEvent.findMany({
      orderBy: { occurred_at: 'desc' },
      select: {
        id: true,
        tenant_id: true,
        employee_id: true,
        type: true,
        occurred_at: true,
      },
    });

    const latestPerEmployee = new Map<string, (typeof events)[0]>();
    for (const event of events) {
      if (!latestPerEmployee.has(event.employee_id)) {
        latestPerEmployee.set(event.employee_id, event);
      }
    }

    const orphaned = Array.from(latestPerEmployee.values()).filter(
      (event) => event.type !== AttendanceEventType.CLOCK_OUT,
    );

    if (orphaned.length === 0) {
      this.logger.log('HR shift-close job: no orphaned shifts found.');
      return;
    }

    this.logger.log(
      `HR shift-close job: closing ${orphaned.length} orphaned shifts.`,
    );

    const results = await chunkedPromiseAll(orphaned, (event) =>
      this.systemPrisma.attendanceEvent.create({
        data: {
          tenant_id: event.tenant_id,
          employee_id: event.employee_id,
          type: AttendanceEventType.CLOCK_OUT,
          source: AttendanceEventSource.AUTO_SHIFT_CLOSE,
          occurred_at: now,
        },
      }),
    );

    this.logger.log(
      `HR shift-close job completed: closed ${results.length} shifts.`,
    );
  }
}
