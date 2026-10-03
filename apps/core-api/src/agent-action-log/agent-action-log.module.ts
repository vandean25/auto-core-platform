import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AgentActionLogAuthorization } from './agent-action-log.authorization.js';
import { AgentActionLogController } from './agent-action-log.controller.js';
import { AgentActionLogService } from './agent-action-log.service.js';

@Module({
  imports: [PrismaModule, CommonModule],
  controllers: [AgentActionLogController],
  providers: [AgentActionLogService, AgentActionLogAuthorization],
  exports: [AgentActionLogService],
})
export class AgentActionLogModule {}
