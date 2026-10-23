import { Module } from '@nestjs/common';
import { CommonModule } from '../common/index.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { VehicleStockModule } from '../vehicle-stock/vehicle-stock.module.js';
import { VoiceTranslationModule } from '../voice-translation/voice-translation.module.js';
import { WorkshopInspectionService } from '../workshop/workshop-inspection.service.js';
import { AgentProposalModule } from '../agent-proposal/agent-proposal.module.js';
import { WorkshopModule } from '../workshop/workshop.module.js';
import { MechanicFindingService } from './mechanic-finding.service.js';
import { MechanicMcpModule } from './mechanic-mcp.module.js';
import { MechanicExecutionService } from './mechanic-execution.service.js';
import { MechanicIdentityService } from './mechanic-identity.service.js';
import { MechanicMediaService } from './mechanic-media.service.js';
import { MechanicSchedulerService } from './mechanic-scheduler.service.js';
import { MechanicVoiceNoteService } from './mechanic-voice-note.service.js';
import { MechanicController } from './mechanic.controller.js';
import { PrismaRateLimitStore } from './rate-limit/prisma-rate-limit.store.js';
import { RateLimitStore } from './rate-limit/rate-limit.store.js';

@Module({
  imports: [
    PrismaModule,
    CommonModule,
    VoiceTranslationModule,
    VehicleStockModule,
    NotificationsModule,
    AgentProposalModule,
    WorkshopModule,
    MechanicMcpModule,
  ],
  controllers: [MechanicController],
  providers: [
    MechanicIdentityService,
    MechanicExecutionService,
    MechanicMediaService,
    MechanicVoiceNoteService,
    WorkshopInspectionService,
    MechanicSchedulerService,
    MechanicFindingService,
    {
      provide: RateLimitStore,
      useClass: PrismaRateLimitStore,
    },
  ],
  exports: [MechanicMcpModule],
})
export class MechanicModule {}
