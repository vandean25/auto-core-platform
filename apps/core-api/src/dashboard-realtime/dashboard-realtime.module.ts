import { Global, Module, forwardRef } from '@nestjs/common';
import { DashboardGateway } from './dashboard.gateway';
import { DashboardRealtimeService } from './dashboard-realtime.service';
import { AuthModule } from '../auth/auth.module';

@Global()
@Module({
  imports: [forwardRef(() => AuthModule)],
  providers: [DashboardGateway, DashboardRealtimeService],
  exports: [DashboardRealtimeService],
})
export class DashboardRealtimeModule {}
