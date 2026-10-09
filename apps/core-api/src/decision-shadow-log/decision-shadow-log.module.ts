import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { DecisionShadowLogAuthorization } from './decision-shadow-log.authorization.js';
import { DecisionShadowLogController } from './decision-shadow-log.controller.js';
import { DecisionShadowLogService } from './decision-shadow-log.service.js';

@Module({
  imports: [PrismaModule, CommonModule],
  controllers: [DecisionShadowLogController],
  providers: [DecisionShadowLogService, DecisionShadowLogAuthorization],
})
export class DecisionShadowLogModule {}
