import { Global, Module } from '@nestjs/common';
import { RequestContextService } from '../common/services/request-context.service.js';
import { SiteContextService } from '../common/services/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';

const NOOP_DASHBOARD_REALTIME = {
  emitEntityUpdated: () => undefined,
};

/**
 * Worker-scoped Prisma module: omits DashboardRealtimeModule (and its AuthModule import)
 * because the PDF worker has no WebSocket gateway.
 */
@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      useFactory: () => new PrismaService(NOOP_DASHBOARD_REALTIME),
    },
    SystemPrismaService,
    TenantContextService,
    RequestContextService,
    SiteContextService,
  ],
  exports: [
    PrismaService,
    SystemPrismaService,
    TenantContextService,
    RequestContextService,
    SiteContextService,
  ],
})
export class WorkerPrismaModule {}
