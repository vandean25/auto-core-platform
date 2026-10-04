import { Global, Module } from '@nestjs/common';
import { RequestContextService } from '../common/services/request-context.service.js';
import { SiteContextService } from '../common/services/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { DashboardRealtimeModule } from '../dashboard-realtime/dashboard-realtime.module.js';
import { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service.js';
import { PrismaService } from './prisma.service.js';
import { SystemPrismaService } from './system-prisma.service.js';

@Global()
@Module({
  imports: [DashboardRealtimeModule],
  providers: [
    {
      provide: PrismaService,
      useFactory: (dashboardRealtime: DashboardRealtimeService) => {
        return new PrismaService(dashboardRealtime);
      },
      inject: [DashboardRealtimeService],
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
export class PrismaModule {}
