import { Module } from '@nestjs/common';
import { HrModule } from '../hr/hr.module.js';
import { LoanerVehiclesModule } from '../loaner-vehicles/loaner-vehicles.module.js';
import { SiteModule } from '../site/site.module.js';
import { WorkshopModule } from '../workshop/workshop.module.js';
import { HrStaffAvailabilityService } from '../hr/hr-staff-availability.service.js';
import { McpWave2ReadFacade } from './mcp-wave2-read.facade.js';
import { McpWave2ReadListsService } from './mcp-wave2-read-lists.service.support.js';

@Module({
  imports: [HrModule, LoanerVehiclesModule, WorkshopModule, SiteModule],
  providers: [
    HrStaffAvailabilityService,
    McpWave2ReadListsService,
    McpWave2ReadFacade,
  ],
  exports: [McpWave2ReadFacade],
})
export class McpReadWave2Module {}
