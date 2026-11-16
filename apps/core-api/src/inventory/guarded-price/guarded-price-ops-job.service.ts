import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InventoryPriceOperationState, Prisma } from '@prisma/client';
import * as Sentry from '@sentry/node';
import { RequestContextService } from '../../common/services/request-context.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SystemPrismaService } from '../../prisma/system-prisma.service.js';
import type { CoreApiCronJobRunner } from '../../scheduler/core-api-cron-job-runner.js';
import {
  selectAndLockStaleAcceptedPriceOperations,
  setGuardedPriceTxALockTimeout,
} from '../guarded-price-operation-locks.js';
import {
  GUARDED_PRICE_JOB_BATCH_SIZE,
  GUARDED_PRICE_RETENTION_MS,
  GUARDED_PRICE_STALE_ACCEPTED_ALERT_MS,
  GUARDED_PRICE_SYSTEM_FENCE_AGE_MS,
} from './guarded-price.constants.js';
import { isLockTimeoutError } from './guarded-price.helpers.js';
import { uuidV7TimestampMillis } from './guarded-price.uuid.js';

export const INVENTORY_PRICE_OPS_JOB_NAME = 'inventory-price-ops-job';

const MAX_BATCH_ATTEMPTS = 3;

const FINAL_STATES: InventoryPriceOperationState[] = [
  InventoryPriceOperationState.APPLIED,
  InventoryPriceOperationState.CONFLICT,
  InventoryPriceOperationState.FENCED,
];

type SentryMonitorConfig = NonNullable<
  Parameters<typeof Sentry.captureCheckIn>[1]
>;

const INVENTORY_PRICE_OPS_MONITOR_CONFIG: SentryMonitorConfig = {
  schedule: { type: 'crontab', value: '0 * * * *' },
  checkinMargin: 5,
  maxRuntime: 15,
  timezone: 'UTC',
};

export interface InventoryPriceOpsJobReport {
  fencedCount: number;
  deletedCount: number;
  staleAcceptedCount: number;
  staleAlertEmitted: boolean;
}

type RetentionCandidate = {
  state: InventoryPriceOperationState;
  key: string;
  final_at: Date | null;
  accepted_at: Date;
};

export function isFinalOperationPastRetention(
  row: RetentionCandidate,
  cutoffMs: number,
): boolean {
  if (row.state === InventoryPriceOperationState.ACCEPTED) {
    return false;
  }
  const finalMs = row.final_at?.getTime() ?? row.accepted_at.getTime();
  const keyMs = uuidV7TimestampMillis(row.key) ?? finalMs;
  return Math.max(finalMs, keyMs) < cutoffMs;
}

function isTransientBatchError(error: unknown): boolean {
  if (isLockTimeoutError(error)) {
    return true;
  }
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = (error as { code?: string }).code;
  return code === '40001' || code === '40P01';
}

async function runWithRetries<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_BATCH_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === MAX_BATCH_ATTEMPTS || !isTransientBatchError(error)) {
        throw error;
      }
    }
  }
  throw lastError;
}

@Injectable()
export class GuardedPriceOpsJobService implements CoreApiCronJobRunner {
  private readonly logger = new Logger(GuardedPriceOpsJobService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly systemPrisma: SystemPrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: INVENTORY_PRICE_OPS_JOB_NAME })
  async handleCron(): Promise<void> {
    await this.run();
  }

  async run(): Promise<boolean> {
    return this.systemPrisma.withCronJobLock(
      INVENTORY_PRICE_OPS_JOB_NAME,
      async () => {
        await this.executeWithMonitor();
      },
      this.logger,
    );
  }

  async executeWithMonitor(
    now = new Date(),
  ): Promise<InventoryPriceOpsJobReport> {
    const startedAtMs = Date.now();
    const checkInId = Sentry.captureCheckIn(
      {
        monitorSlug: INVENTORY_PRICE_OPS_JOB_NAME,
        status: 'in_progress',
      },
      INVENTORY_PRICE_OPS_MONITOR_CONFIG,
    );

    try {
      const report = await this.runSweep(now);
      Sentry.captureCheckIn(
        {
          checkInId,
          monitorSlug: INVENTORY_PRICE_OPS_JOB_NAME,
          status: 'ok',
          duration: (Date.now() - startedAtMs) / 1000,
        },
        INVENTORY_PRICE_OPS_MONITOR_CONFIG,
      );
      return report;
    } catch (error) {
      Sentry.captureCheckIn(
        {
          checkInId,
          monitorSlug: INVENTORY_PRICE_OPS_JOB_NAME,
          status: 'error',
          duration: (Date.now() - startedAtMs) / 1000,
        },
        INVENTORY_PRICE_OPS_MONITOR_CONFIG,
      );
      throw error;
    }
  }

  async runSweep(now = new Date()): Promise<InventoryPriceOpsJobReport> {
    const tenants = await this.systemPrisma.tenant.findMany({
      select: { id: true },
    });

    let fencedCount = 0;
    let deletedCount = 0;
    let staleAcceptedCount = 0;

    for (const tenant of tenants) {
      const counts = await this.requestContext.runAsWorker(
        tenant.id,
        () => this.runTenantSweep(tenant.id, now),
        { workerId: INVENTORY_PRICE_OPS_JOB_NAME },
      );
      fencedCount += counts.fencedCount;
      deletedCount += counts.deletedCount;
      staleAcceptedCount += counts.staleAcceptedCount;
    }

    const staleAlertEmitted = staleAcceptedCount > 0;
    if (staleAlertEmitted) {
      const alertMessage = `Stale ACCEPTED inventory price operations older than 25h: ${staleAcceptedCount}`;
      this.logger.error(alertMessage);
      Sentry.captureMessage(alertMessage, {
        level: 'error',
        tags: { job: INVENTORY_PRICE_OPS_JOB_NAME },
        extra: { staleAcceptedCount },
      });
    }

    this.logger.log(
      `Inventory price ops job finished: fenced=${fencedCount} deleted=${deletedCount} staleAccepted=${staleAcceptedCount}`,
    );

    return {
      fencedCount,
      deletedCount,
      staleAcceptedCount,
      staleAlertEmitted,
    };
  }

  private async runTenantSweep(
    tenantId: string,
    now: Date,
  ): Promise<{
    fencedCount: number;
    deletedCount: number;
    staleAcceptedCount: number;
  }> {
    const fencedCount = await this.fenceStaleAccepted(tenantId, now);
    const deletedCount = await this.purgeExpiredFinal(tenantId, now);
    const staleAcceptedCount = await this.countStaleAccepted(tenantId, now);
    return { fencedCount, deletedCount, staleAcceptedCount };
  }

  private async fenceStaleAccepted(
    tenantId: string,
    now: Date,
  ): Promise<number> {
    const cutoff = new Date(now.getTime() - GUARDED_PRICE_SYSTEM_FENCE_AGE_MS);
    let fencedTotal = 0;

    while (true) {
      const batchFenced = await runWithRetries(() =>
        this.fenceNextBatch(tenantId, cutoff, now),
      );
      fencedTotal += batchFenced;
      if (batchFenced < GUARDED_PRICE_JOB_BATCH_SIZE) {
        break;
      }
    }

    return fencedTotal;
  }

  private async fenceNextBatch(
    tenantId: string,
    cutoff: Date,
    now: Date,
  ): Promise<number> {
    return this.prisma.$transaction(
      async (tx) => {
        await setGuardedPriceTxALockTimeout(tx);
        const rows = await selectAndLockStaleAcceptedPriceOperations(
          tx,
          tenantId,
          cutoff,
          GUARDED_PRICE_JOB_BATCH_SIZE,
        );
        if (rows.length === 0) {
          return 0;
        }
        const ids = rows.map((row) => row.id);
        const result = await tx.inventoryPriceOperation.updateMany({
          where: {
            tenant_id: tenantId,
            id: { in: ids },
            state: InventoryPriceOperationState.ACCEPTED,
          },
          data: {
            state: InventoryPriceOperationState.FENCED,
            final_at: now,
            error_code: 'OPERATION_FENCED',
          },
        });
        return result.count;
      },
      {
        timeout: 10_000,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
  }

  private async purgeExpiredFinal(
    tenantId: string,
    now: Date,
  ): Promise<number> {
    const cutoffMs = now.getTime() - GUARDED_PRICE_RETENTION_MS;
    const cutoff = new Date(cutoffMs);
    let deletedTotal = 0;
    let lastId = '';

    while (true) {
      const candidates = await runWithRetries(() =>
        this.prisma.inventoryPriceOperation.findMany({
          where: {
            tenant_id: tenantId,
            ...(lastId ? { id: { gt: lastId } } : {}),
            state: { in: FINAL_STATES },
            OR: [
              { final_at: { lt: cutoff } },
              { final_at: null, accepted_at: { lt: cutoff } },
            ],
          },
          select: {
            id: true,
            state: true,
            key: true,
            final_at: true,
            accepted_at: true,
          },
          orderBy: { id: 'asc' },
          take: GUARDED_PRICE_JOB_BATCH_SIZE,
        }),
      );

      if (candidates.length === 0) {
        break;
      }

      lastId = candidates[candidates.length - 1].id;
      const eligibleIds = candidates
        .filter((row) => isFinalOperationPastRetention(row, cutoffMs))
        .map((row) => row.id);

      if (eligibleIds.length > 0) {
        const deleted = await runWithRetries(() =>
          this.prisma.inventoryPriceOperation.deleteMany({
            where: {
              tenant_id: tenantId,
              id: { in: eligibleIds },
              state: { in: FINAL_STATES },
            },
          }),
        );
        deletedTotal += deleted.count;
      }

      if (candidates.length < GUARDED_PRICE_JOB_BATCH_SIZE) {
        break;
      }
    }

    return deletedTotal;
  }

  private async countStaleAccepted(
    tenantId: string,
    now: Date,
  ): Promise<number> {
    const staleCutoff = new Date(
      now.getTime() - GUARDED_PRICE_STALE_ACCEPTED_ALERT_MS,
    );
    return this.prisma.inventoryPriceOperation.count({
      where: {
        tenant_id: tenantId,
        state: InventoryPriceOperationState.ACCEPTED,
        accepted_at: { lt: staleCutoff },
      },
    });
  }
}
