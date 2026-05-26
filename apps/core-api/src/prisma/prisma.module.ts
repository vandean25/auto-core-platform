import { Global, Module, forwardRef } from '@nestjs/common';
import { RequestContextService } from '../common/services/request-context.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import { DashboardRealtimeModule } from '../dashboard-realtime/dashboard-realtime.module';
import { PrismaService } from './prisma.service';
import { SystemPrismaService } from './system-prisma.service';

@Global()
@Module({
  imports: [forwardRef(() => DashboardRealtimeModule)],
  providers: [
    PrismaService,
    SystemPrismaService,
    TenantContextService,
    RequestContextService,
  ],
  exports: [
    PrismaService,
    SystemPrismaService,
    TenantContextService,
    RequestContextService,
  ],
})
export class PrismaModule {}
