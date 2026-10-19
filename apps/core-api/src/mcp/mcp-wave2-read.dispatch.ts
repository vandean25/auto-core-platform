import type { McpWave2ReadFacade } from './mcp-wave2-read.facade.js';
import type { McpWave2ReadToolName } from './mcp-read-wave2-catalog.js';
import type {
  getCheckInInputSchema,
  getStaffAvailabilityInputSchema,
  listEstimatesInputSchema,
  listLoanerBookingsInputSchema,
  listOrderCommunicationsInputSchema,
} from './mcp-read-wave2-schemas.js';
import type { z } from 'zod';

type ParsedWave2Input = {
  list_loaner_bookings: z.infer<typeof listLoanerBookingsInputSchema>;
  list_estimates: z.infer<typeof listEstimatesInputSchema>;
  list_order_communications: z.infer<typeof listOrderCommunicationsInputSchema>;
  get_check_in: z.infer<typeof getCheckInInputSchema>;
  get_staff_availability: z.infer<typeof getStaffAvailabilityInputSchema>;
};

export function runMcpWave2ReadTool(
  facade: McpWave2ReadFacade,
  toolName: McpWave2ReadToolName,
  parsed: ParsedWave2Input[McpWave2ReadToolName],
): Promise<unknown> {
  switch (toolName) {
    case 'list_loaner_bookings':
      return facade.listLoanerBookings(
        parsed as ParsedWave2Input['list_loaner_bookings'],
      );
    case 'list_estimates':
      return facade.listEstimates(parsed as ParsedWave2Input['list_estimates']);
    case 'list_order_communications':
      return facade.listOrderCommunications(
        parsed as ParsedWave2Input['list_order_communications'],
      );
    case 'get_check_in':
      return facade.getCheckIn(parsed as ParsedWave2Input['get_check_in']);
    case 'get_staff_availability':
      return facade.getStaffAvailability(
        parsed as ParsedWave2Input['get_staff_availability'],
      );
  }
}
