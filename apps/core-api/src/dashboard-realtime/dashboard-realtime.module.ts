import { Global, Module, forwardRef } from '@nestjs/common';
import { DashboardGateway } from './dashboard.gateway.js';
import { DashboardRealtimeService } from './dashboard-realtime.service.js';
import { AuthModule } from '../auth/auth.module.js';
import {
  DASHBOARD_GATEWAY_TOKEN,
  DASHBOARD_REALTIME_SERVICE_TOKEN,
} from './dashboard-realtime.tokens.js';

@Global()
@Module({
  imports: [forwardRef(() => AuthModule)],
  providers: [
    DashboardGateway,
    { provide: DASHBOARD_GATEWAY_TOKEN, useExisting: DashboardGateway },
    DashboardRealtimeService,
    {
      provide: DASHBOARD_REALTIME_SERVICE_TOKEN,
      useExisting: DashboardRealtimeService,
    },
  ],
  exports: [DashboardRealtimeService],
})
export class DashboardRealtimeModule {}
