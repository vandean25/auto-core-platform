import { Module } from '@nestjs/common';
import { DashboardRealtimeModule } from '../dashboard-realtime/dashboard-realtime.module.js';
import { SavedViewsController } from './saved-views.controller.js';
import { SavedViewsService } from './saved-views.service.js';

@Module({
  imports: [DashboardRealtimeModule],
  controllers: [SavedViewsController],
  providers: [SavedViewsService],
  exports: [SavedViewsService],
})
export class SavedViewsModule {}
