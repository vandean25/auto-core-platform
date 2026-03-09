import { Global, Module } from '@nestjs/common';
import { DashboardGateway } from './dashboard.gateway';
import { DashboardRealtimeService } from './dashboard-realtime.service';

@Global()
@Module({
  providers: [DashboardGateway, DashboardRealtimeService],
  exports: [DashboardRealtimeService],
})
export class DashboardRealtimeModule {}
