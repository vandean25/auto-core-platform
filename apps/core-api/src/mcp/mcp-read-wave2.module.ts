import { Module } from '@nestjs/common';
import { HrModule } from '../hr/hr.module.js';
import { LoanerVehiclesModule } from '../loaner-vehicles/loaner-vehicles.module.js';
import { SiteModule } from '../site/site.module.js';
import { WorkshopModule } from '../workshop/workshop.module.js';
import { McpToolHandlerWave2Wrapper } from './mcp-tool-handler.wave2-wrapper.js';
import { McpWave2ReadFacade } from './mcp-wave2-read.facade.js';
import { McpWave2ReadListsService } from './mcp-wave2-read-lists.service.js';

@Module({
  imports: [HrModule, LoanerVehiclesModule, WorkshopModule, SiteModule],
  providers: [
    McpWave2ReadListsService,
    McpWave2ReadFacade,
    McpToolHandlerWave2Wrapper,
  ],
  exports: [McpToolHandlerWave2Wrapper, McpWave2ReadFacade],
})
export class McpReadWave2Module {}
