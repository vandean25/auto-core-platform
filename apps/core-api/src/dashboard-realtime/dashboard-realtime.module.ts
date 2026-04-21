import { Global, Module } from '@nestjs/common';
import { DashboardGateway } from './dashboard.gateway';
import { DashboardRealtimeService } from './dashboard-realtime.service';
import { AuthModule } from '../auth/auth.module';

@Global()
@Module({
  imports: [AuthModule],
  providers: [DashboardGateway, DashboardRealtimeService],
  exports: [DashboardRealtimeService],
})
export class DashboardRealtimeModule {}
