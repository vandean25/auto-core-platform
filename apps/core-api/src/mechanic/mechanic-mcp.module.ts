import { Module } from '@nestjs/common';
import { CommonModule } from '../common/index.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SiteModule } from '../site/site.module.js';
import { MechanicFindingProposeService } from './mechanic-finding-propose.service.js';
import { WorkshopMediaUploadMcpService } from './workshop-media-upload-mcp.service.js';
import { MechanicMediaStorage } from './mechanic-media.storage.js';

/** MCP-facing mechanic services without AgentProposalModule (avoids import cycles). */
@Module({
  imports: [PrismaModule, CommonModule, SiteModule],
  providers: [
    MechanicMediaStorage,
    MechanicFindingProposeService,
    WorkshopMediaUploadMcpService,
  ],
  exports: [
    MechanicMediaStorage,
    MechanicFindingProposeService,
    WorkshopMediaUploadMcpService,
  ],
})
export class MechanicMcpModule {}
