import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CommonModule } from '../common/index.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { VehicleStockModule } from '../vehicle-stock/vehicle-stock.module.js';
import { VoiceTranslationModule } from '../voice-translation/voice-translation.module.js';
import { MechanicExecutionService } from './mechanic-execution.service.js';
import { MechanicIdentityService } from './mechanic-identity.service.js';
import { MechanicMediaService } from './mechanic-media.service.js';
import { MechanicMediaStorage } from './mechanic-media.storage.js';
import { MechanicSchedulerService } from './mechanic-scheduler.service.js';
import { MechanicVoiceNoteService } from './mechanic-voice-note.service.js';
import { MechanicController } from './mechanic.controller.js';
import { PrismaRateLimitStore } from './rate-limit/prisma-rate-limit.store.js';
import { RateLimitStore } from './rate-limit/rate-limit.store.js';

@Module({
  imports: [
    PrismaModule,
    CommonModule,
    ScheduleModule.forRoot(),
    VoiceTranslationModule,
    VehicleStockModule,
  ],
  controllers: [MechanicController],
  providers: [
    MechanicIdentityService,
    MechanicExecutionService,
    MechanicMediaService,
    MechanicVoiceNoteService,
    MechanicSchedulerService,
    MechanicMediaStorage,
    {
      provide: RateLimitStore,
      useClass: PrismaRateLimitStore,
    },
  ],
})
export class MechanicModule {}
