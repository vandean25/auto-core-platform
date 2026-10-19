import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { McpWave2ReadListsService } from './mcp-wave2-read-lists.service.js';
import type {
  getCheckInInputSchema,
  getStaffAvailabilityInputSchema,
  listEstimatesInputSchema,
  listLoanerBookingsInputSchema,
  listOrderCommunicationsInputSchema,
} from './mcp-tool-schemas.aut615-reads.js';

@Injectable()
export class McpWave2ReadFacade {
  constructor(private readonly lists: McpWave2ReadListsService) {}

  listLoanerBookings(
    input: z.infer<typeof listLoanerBookingsInputSchema>,
  ) {
    return this.lists.listLoanerBookings(input);
  }

  listEstimates(input: z.infer<typeof listEstimatesInputSchema>) {
    return this.lists.listEstimates(input);
  }

  listOrderCommunications(
    input: z.infer<typeof listOrderCommunicationsInputSchema>,
  ) {
    return this.lists.listOrderCommunications(input);
  }

  getCheckIn(input: z.infer<typeof getCheckInInputSchema>) {
    return this.lists.getCheckIn(input);
  }

  getStaffAvailability(
    input: z.infer<typeof getStaffAvailabilityInputSchema>,
  ) {
    return this.lists.getStaffAvailability(input);
  }
}
