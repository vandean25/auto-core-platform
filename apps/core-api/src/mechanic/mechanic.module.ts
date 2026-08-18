import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CommonModule } from '../common';
import { PrismaModule } from '../prisma/prisma.module';
import { VehicleStockModule } from '../vehicle-stock/vehicle-stock.module';
import { VoiceTranslationModule } from '../voice-translation/voice-translation.module';
import { MechanicMediaStorage } from './mechanic-media.storage';
import { MechanicSchedulerService } from './mechanic-scheduler.service';
import { MechanicController } from './mechanic.controller';
import { MechanicService } from './mechanic.service';

@Module({
  imports: [
    PrismaModule,
    CommonModule,
    ScheduleModule.forRoot(),
    VoiceTranslationModule,
    VehicleStockModule,
  ],
  controllers: [MechanicController],
  providers: [MechanicService, MechanicSchedulerService, MechanicMediaStorage],
})
export class MechanicModule {}
