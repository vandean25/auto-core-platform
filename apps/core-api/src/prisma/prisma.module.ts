import { Global, Module } from '@nestjs/common';
import { DashboardRealtimeModule } from '../dashboard-realtime/dashboard-realtime.module';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  imports: [DashboardRealtimeModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
