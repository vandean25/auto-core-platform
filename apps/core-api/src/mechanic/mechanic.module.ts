import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CommonModule } from '../common';
import { PrismaModule } from '../prisma/prisma.module';
import { MechanicSchedulerService } from './mechanic-scheduler.service';
import { MechanicController } from './mechanic.controller';
import { MechanicService } from './mechanic.service';

@Module({
  imports: [PrismaModule, CommonModule, ScheduleModule.forRoot()],
  controllers: [MechanicController],
  providers: [MechanicService, MechanicSchedulerService],
})
export class MechanicModule {}
