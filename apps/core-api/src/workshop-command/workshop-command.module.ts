import { Module } from '@nestjs/common';
import { AgentProposalModule } from '../agent-proposal/agent-proposal.module.js';
import { LoanerVehiclesModule } from '../loaner-vehicles/loaner-vehicles.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { WorkshopCommandController } from './workshop-command.controller.js';
import { WorkshopCommandResolver } from './workshop-command.resolve.js';
import { WorkshopCommandService } from './workshop-command.service.js';
import { WorkshopCommandSessionRetentionService } from './workshop-command-session-retention.service.js';
import { WorkshopCommandSessionService } from './workshop-command-session.service.js';

@Module({
  imports: [PrismaModule, LoanerVehiclesModule, AgentProposalModule],
  controllers: [WorkshopCommandController],
  providers: [
    WorkshopCommandResolver,
    WorkshopCommandSessionService,
    WorkshopCommandSessionRetentionService,
    WorkshopCommandService,
  ],
  exports: [WorkshopCommandSessionService],
})
export class WorkshopCommandModule {}
