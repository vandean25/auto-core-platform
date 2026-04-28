import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LaborPauseReason } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { chunkedPromiseAll } from '../common/utils/promise.util';

/**
 * Nightly scheduled job that force-closes orphaned `LaborEntry` records.
 *
 * Runs at 23:59 every day (ADR-0014 §4.1.1).
 * Sets `ended_at = now()` and `pause_reason = AUTO_SHIFT_CLOSE`.
 * Does NOT alter task or order status — tasks remain resumable the next shift.
 */
@Injectable()
export class MechanicSchedulerService {
  private readonly logger = new Logger(MechanicSchedulerService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('59 23 * * *', { name: 'mechanic-shift-close' })
  async closeOrphanedLaborEntries(): Promise<void> {
    this.logger.log('Shift-close job started: closing orphaned labor entries.');

    // This is an intentional system-level cross-tenant operation. Unlike
    // request-scoped service methods (which must always filter by tenant_id),
    // this nightly scheduler is a privileged background maintenance job that
    // closes ALL dangling open labor entries regardless of tenant, analogous to
    // a DBA running a global maintenance query. It does not read, return, or
    // expose any per-tenant data — it only sets ended_at and pause_reason.
    // ADR-0014 §4.1.1: "force-closes any LaborEntry records where ended_at IS NULL".
    const openEntries = await this.prisma.laborEntry.findMany({
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
      this.prisma.laborEntry.update({
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
