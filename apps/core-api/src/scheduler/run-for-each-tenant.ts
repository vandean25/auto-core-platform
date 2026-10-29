import { Logger } from '@nestjs/common';
import type { RequestContextService } from '../common/services/request-context.service.js';
import type { SystemPrismaService } from '../prisma/system-prisma.service.js';

/**
 * Runs one cron job's work once per tenant under a worker context. One tenant's failure is logged and does not skip
 * the tenants after it; the next run retries it.
 */
export async function runForEachTenant(
  deps: {
    systemPrisma: SystemPrismaService;
    requestContext: RequestContextService;
    logger: Logger;
  },
  workerId: string,
  work: (tenantId: string, now: Date) => Promise<void>,
): Promise<void> {
  const tenants = await deps.systemPrisma.tenant.findMany({
    select: { id: true },
  });
  const now = new Date();
  for (const { id: tenantId } of tenants) {
    try {
      await deps.requestContext.runAsWorker(
        tenantId,
        () => work(tenantId, now),
        {
          workerId,
        },
      );
    } catch (cause) {
      deps.logger.error(
        `${workerId} failed for one tenant: ${cause instanceof Error ? cause.name : 'unknown error'}`,
      );
    }
  }
}
