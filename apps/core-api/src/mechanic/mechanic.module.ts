import { Module } from '@nestjs/common';
import { CommonModule } from '../common';
import { PrismaModule } from '../prisma/prisma.module';
import { MechanicController } from './mechanic.controller';
import { MechanicService } from './mechanic.service';

@Module({
  imports: [PrismaModule, CommonModule],
  controllers: [MechanicController],
  providers: [MechanicService],
})
export class MechanicModule {}
