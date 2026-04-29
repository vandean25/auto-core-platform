import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LaborPauseReason } from '@prisma/client';
import { SystemPrismaService } from '../prisma/system-prisma.service';
import { chunkedPromiseAll } from '../common/utils/promise.util';

/**
 * Nightly scheduled job that force-closes orphaned `LaborEntry` records.
 *
 * Runs at 23:59 every day (ADR-0014 §4.1.1).
 * Sets `ended_at = now()` and `pause_reason = AUTO_SHIFT_CLOSE`.
 * Does NOT alter task or order status — tasks remain resumable the next shift.
 *
 * Uses `SystemPrismaService` (plain PrismaClient without the tenant-isolation
 * extension) because cron jobs run outside request context where
 * `TenantContextStorage` is unset, and this is an intentional cross-tenant
 * maintenance operation.
 */
@Injectable()
export class MechanicSchedulerService {
  private readonly logger = new Logger(MechanicSchedulerService.name);

  constructor(private readonly systemPrisma: SystemPrismaService) {}

  @Cron('59 23 * * *', { name: 'mechanic-shift-close' })
  async closeOrphanedLaborEntries(): Promise<void> {
    this.logger.log('Shift-close job started: closing orphaned labor entries.');

    // Pre-fetch all open entries so we can batch writes without an N+1 loop.
    const openEntries = await this.systemPrisma.laborEntry.findMany({
      where: { ended_at: null },
      select: { id: true },
    });

    if (openEntries.length === 0) {
      this.logger.log('Shift-close job: no orphaned entries found.');
      return;
    }

    this.logger.log(
      `Shift-close job: closing ${openEntries.length} orphaned labor entries.`,
    );

    const now = new Date();

    // Use chunkedPromiseAll to close entries concurrently in bounded batches
    // rather than one unbounded Promise.all (ADR-0014 §4.1.1 + performance rule).
    const results = await chunkedPromiseAll(openEntries, (entry) =>
      this.systemPrisma.laborEntry.update({
        where: { id: entry.id },
        data: {
          ended_at: now,
          pause_reason: LaborPauseReason.AUTO_SHIFT_CLOSE,
        },
      }),
    );

    this.logger.log(
      `Shift-close job completed: closed ${results.length} labor entries.`,
    );
  }
}
