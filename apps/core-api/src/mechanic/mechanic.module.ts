import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CommonModule } from '../common';
import { PrismaModule } from '../prisma/prisma.module';
import { VehicleStockModule } from '../vehicle-stock/vehicle-stock.module';
import { VoiceTranslationModule } from '../voice-translation/voice-translation.module';
import { MechanicExecutionService } from './mechanic-execution.service';
import { MechanicIdentityService } from './mechanic-identity.service';
import { MechanicMediaService } from './mechanic-media.service';
import { MechanicMediaStorage } from './mechanic-media.storage';
import { MechanicSchedulerService } from './mechanic-scheduler.service';
import { MechanicVoiceNoteService } from './mechanic-voice-note.service';
import { MechanicController } from './mechanic.controller';
import { PrismaRateLimitStore } from './rate-limit/prisma-rate-limit.store';
import { RateLimitStore } from './rate-limit/rate-limit.store';

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
