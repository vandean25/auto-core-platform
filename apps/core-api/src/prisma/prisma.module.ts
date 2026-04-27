import { Global, Module, forwardRef } from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service';
import { DashboardRealtimeModule } from '../dashboard-realtime/dashboard-realtime.module';
import { PrismaService } from './prisma.service';
import { SystemPrismaService } from './system-prisma.service';

@Global()
@Module({
  imports: [forwardRef(() => DashboardRealtimeModule)],
  providers: [PrismaService, SystemPrismaService, TenantContextService],
  exports: [PrismaService, SystemPrismaService, TenantContextService],
})
export class PrismaModule {}
