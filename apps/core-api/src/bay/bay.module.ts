import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BayController } from './bay.controller';
import { BayService } from './bay.service';

@Module({
  imports: [PrismaModule],
  controllers: [BayController],
  providers: [BayService],
})
export class BayModule {}
