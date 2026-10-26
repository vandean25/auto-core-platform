import type { Logger } from '@nestjs/common';
import type { RequestContextService } from '../common/services/request-context.service.js';
import type { SystemPrismaService } from '../prisma/system-prisma.service.js';

export async function runDocumentBrandingRecoveryCron(params: {
  jobName: string;
  logger: Logger;
  systemPrisma: SystemPrismaService;
  requestContext: RequestContextService;
  workerId: string;
  runForTenant: (now: Date) => Promise<void>;
}): Promise<boolean> {
  return params.systemPrisma.withCronJobLock(
    params.jobName,
    async () => {
      const tenants = await params.systemPrisma.tenant.findMany({
        select: { id: true },
      });
      if (tenants.length === 0) return;

      const now = new Date();
      for (const { id: tenantId } of tenants) {
        await params.requestContext.runAsWorker(
          tenantId,
          () => params.runForTenant(now),
          { workerId: params.workerId },
        );
      }
    },
    params.logger,
  );
}
