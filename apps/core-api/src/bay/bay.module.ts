import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BayController } from './bay.controller.js';
import { BayService } from './bay.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [BayController],
  providers: [BayService],
})
export class BayModule {}
