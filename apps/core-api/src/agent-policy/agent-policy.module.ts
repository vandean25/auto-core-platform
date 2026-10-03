import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AgentPolicyController } from './agent-policy.controller.js';
import { AgentPolicyService } from './agent-policy.service.js';

@Module({
  imports: [AuditModule],
  controllers: [AgentPolicyController],
  providers: [AgentPolicyService],
  exports: [AgentPolicyService],
})
export class AgentPolicyModule {}
