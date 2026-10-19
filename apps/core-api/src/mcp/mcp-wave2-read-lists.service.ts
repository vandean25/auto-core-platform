import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { LoanerVehiclesService } from '../loaner-vehicles/loaner-vehicles.service.js';
import { HrStaffAvailabilityService } from '../hr/hr-staff-availability.service.js';
import { WorkshopCheckInService } from '../workshop/workshop-check-in.service.js';
import { WorkshopCheckInMediaService } from '../workshop/workshop-check-in-media.service.js';
import { WorkshopEstimateService } from '../workshop/workshop-estimate.service.js';
import { WorkshopEstimateSiteVersionListService } from '../workshop/workshop-estimate-site-version-list.service.js';
import { WorkshopInspectionService } from '../workshop/workshop-inspection.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import {
  runGetCheckIn,
  runGetStaffAvailability,
  runListEstimates,
  runListLoanerBookings,
  runListOrderCommunications,
} from './mcp-wave2-read-lists.handlers.js';
import type {
  getCheckInInputSchema,
  getStaffAvailabilityInputSchema,
  listEstimatesInputSchema,
  listLoanerBookingsInputSchema,
  listOrderCommunicationsInputSchema,
} from './mcp-read-wave2-schemas.js';

@Injectable()
export class McpWave2ReadListsService {
  constructor(
    @Inject(LoanerVehiclesService)
    private readonly loaners: LoanerVehiclesService,
    @Inject(WorkshopEstimateService)
    private readonly estimates: WorkshopEstimateService,
    @Inject(WorkshopEstimateSiteVersionListService)
    private readonly estimateSiteVersions: WorkshopEstimateSiteVersionListService,
    @Inject(WorkshopCheckInService)
    private readonly checkIns: WorkshopCheckInService,
    @Inject(WorkshopCheckInMediaService)
    private readonly checkInMedia: WorkshopCheckInMediaService,
    @Inject(WorkshopInspectionService)
    private readonly inspections: WorkshopInspectionService,
    @Inject(HrStaffAvailabilityService)
    private readonly staffAvailability: HrStaffAvailabilityService,
    @Inject(SiteContextService)
    private readonly siteContext: SiteContextService,
  ) {}

  listLoanerBookings(input: z.infer<typeof listLoanerBookingsInputSchema>) {
    return runListLoanerBookings(
      { loaners: this.loaners, siteContext: this.siteContext },
      input,
    );
  }

  listEstimates(input: z.infer<typeof listEstimatesInputSchema>) {
    return runListEstimates(
      {
        estimateSiteVersions: this.estimateSiteVersions,
        siteContext: this.siteContext,
      },
      input,
    );
  }

  listOrderCommunications(
    input: z.infer<typeof listOrderCommunicationsInputSchema>,
  ) {
    return runListOrderCommunications(
      { estimates: this.estimates, siteContext: this.siteContext },
      input,
    );
  }

  getCheckIn(input: z.infer<typeof getCheckInInputSchema>) {
    return runGetCheckIn(
      {
        checkIns: this.checkIns,
        checkInMedia: this.checkInMedia,
        inspections: this.inspections,
        siteContext: this.siteContext,
      },
      input,
    );
  }

  getStaffAvailability(input: z.infer<typeof getStaffAvailabilityInputSchema>) {
    return runGetStaffAvailability(
      { staffAvailability: this.staffAvailability },
      input,
    );
  }
}
