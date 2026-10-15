import { Module } from '@nestjs/common';
import { AgentProposalModule } from '../agent-proposal/agent-proposal.module.js';
import { CommonModule } from '../common/common.module.js';
import { LoanerVehiclesModule } from '../loaner-vehicles/loaner-vehicles.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AgentSupervisionController } from './agent-supervision.controller.js';
import { AgentSupervisionTriageService } from './agent-supervision-triage.service.js';

@Module({
  imports: [PrismaModule, CommonModule, AgentProposalModule, LoanerVehiclesModule],
  controllers: [AgentSupervisionController],
  providers: [AgentSupervisionTriageService],
})
export class AgentSupervisionModule {}
