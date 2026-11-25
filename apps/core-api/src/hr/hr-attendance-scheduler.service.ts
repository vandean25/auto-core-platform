import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AttendanceEventSource, AttendanceEventType } from '@prisma/client';
import { isRetryableTransactionError } from '../common/prisma/is-retryable-transaction-error.js';
import { chunkedPromiseAll } from '../common/utils/promise.util.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';

const MAX_CLOSE_SHIFT_ATTEMPTS = 3;

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
  async closeOrphanedShifts(): Promise<void> {
    await this.run();
  }

  async run(now: Date = new Date()): Promise<boolean> {
    return this.systemPrisma.withCronJobLock(
      'hr-shift-close',
      async () => {
        await this.closeOrphanedShiftsWork(now);
      },
      this.logger,
    );
  }

  private async closeOrphanedShiftsWork(now: Date): Promise<void> {
    this.logger.log(
      'HR shift-close job started: querying latest attendance events.',
    );

    const grouped = await this.systemPrisma.attendanceEvent.groupBy({
      by: ['tenant_id', 'employee_id'],
      _max: { occurred_at: true },
    });

    const activePastGroups = grouped.filter(
      (g) => g._max.occurred_at && new Date(g._max.occurred_at) < now,
    );

    if (activePastGroups.length === 0) {
      this.logger.log('HR shift-close job: no orphaned shifts found.');
      return;
    }

    const latestEvents = await this.systemPrisma.attendanceEvent.findMany({
      where: {
        OR: activePastGroups.map((g) => ({
          tenant_id: g.tenant_id,
          employee_id: g.employee_id,
          occurred_at: g._max.occurred_at as Date,
        })),
      },
      orderBy: [{ occurred_at: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        tenant_id: true,
        employee_id: true,
        type: true,
        occurred_at: true,
      },
    });

    const latestPerEmployee = new Map<string, (typeof latestEvents)[0]>();
    for (const event of latestEvents) {
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
      this.closeEmployeeShiftWithRetry(event.tenant_id, event.employee_id, now),
    );

    const closedCount = results.filter(Boolean).length;
    this.logger.log(
      `HR shift-close job completed: closed ${closedCount} shifts.`,
    );
  }

  private async closeEmployeeShiftWithRetry(
    tenantId: string,
    employeeId: string,
    now: Date,
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= MAX_CLOSE_SHIFT_ATTEMPTS; attempt++) {
      try {
        return await this.systemPrisma.$transaction(
          async (tx) => {
            const latest = await tx.attendanceEvent.findFirst({
              where: {
                tenant_id: tenantId,
                employee_id: employeeId,
              },
              orderBy: [{ occurred_at: 'desc' }, { createdAt: 'desc' }],
              select: { type: true, occurred_at: true },
            });

            if (
              !latest ||
              latest.type === AttendanceEventType.CLOCK_OUT ||
              new Date(latest.occurred_at) >= now
            ) {
              return false;
            }

            await tx.attendanceEvent.create({
              data: {
                tenant_id: tenantId,
                employee_id: employeeId,
                type: AttendanceEventType.CLOCK_OUT,
                source: AttendanceEventSource.AUTO_SHIFT_CLOSE,
                occurred_at: now,
              },
            });
            return true;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (!isRetryableTransactionError(error)) {
          throw error;
        }
        if (attempt === MAX_CLOSE_SHIFT_ATTEMPTS) {
          this.logger.warn(
            `HR shift-close job: exhausted ${MAX_CLOSE_SHIFT_ATTEMPTS} serialization attempts for employee ${employeeId} (tenant ${tenantId}); skipping.`,
          );
          return false;
        }
      }
    }
    return false;
  }
}
