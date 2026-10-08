import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { MarginRuleController } from './margin-rule.controller.js';
import { MarginRuleService } from './margin-rule.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [MarginRuleController],
  providers: [MarginRuleService],
  exports: [MarginRuleService],
})
export class MarginRuleModule {}
