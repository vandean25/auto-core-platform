import {
  EmployeeRole,
  LoanerBookingStatus,
  WorkshopEstimateStatus,
} from '@prisma/client';
import { z } from 'zod';
import { MCP_MAX_PAGE_SIZE } from './mcp.constants.js';
import type { McpWave2ReadToolName } from './mcp-read-wave2-catalog.js';

const uuidSchema = z.string().uuid();

const pageSizeSchema = z
  .number()
  .int()
  .min(1)
  .max(MCP_MAX_PAGE_SIZE)
  .optional()
  .describe('Page size (max 25)');

const keysetCursorSchema = z
  .string()
  .min(1)
  .optional()
  .describe('Opaque cursor from meta.next_cursor');

const isoInstantSchema = z.string().datetime();
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const listLoanerBookingsInputSchema = z
  .object({
    status: z.nativeEnum(LoanerBookingStatus).optional(),
    loanerId: uuidSchema.optional(),
    customerId: uuidSchema.optional(),
    orderId: uuidSchema.optional(),
    from: isoInstantSchema.optional(),
    to: isoInstantSchema.optional(),
    overdueOnly: z.boolean().optional(),
    pageSize: pageSizeSchema,
    cursor: keysetCursorSchema,
  })
  .superRefine((value, ctx) => {
    if (value.from && value.to && value.from > value.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'from must not be after to',
        path: ['from'],
      });
    }
  });

export const listEstimatesInputSchema = z
  .object({
    customerId: uuidSchema.optional(),
    orderId: uuidSchema.optional(),
    status: z.nativeEnum(WorkshopEstimateStatus).optional(),
    sentFrom: isoDateSchema.optional(),
    sentTo: isoDateSchema.optional(),
    pageSize: pageSizeSchema,
    cursor: keysetCursorSchema,
  })
  .superRefine((value, ctx) => {
    if ((value.sentFrom && !value.sentTo) || (!value.sentFrom && value.sentTo)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'sentFrom and sentTo must be provided together',
        path: ['sentFrom'],
      });
    }
    if (value.sentFrom && value.sentTo && value.sentFrom > value.sentTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'sentFrom must not be after sentTo',
        path: ['sentFrom'],
      });
    }
  });

export const listOrderCommunicationsInputSchema = z.object({
  orderId: uuidSchema,
  pageSize: pageSizeSchema,
  cursor: keysetCursorSchema,
});

export const getCheckInInputSchema = z.object({
  orderId: uuidSchema,
});

export const getStaffAvailabilityInputSchema = z.object({
  date: isoDateSchema.optional(),
  siteId: uuidSchema.optional(),
  role: z.nativeEnum(EmployeeRole).optional(),
});

export const mcpWave2ReadInputSchemas = {
  list_loaner_bookings: listLoanerBookingsInputSchema,
  list_estimates: listEstimatesInputSchema,
  list_order_communications: listOrderCommunicationsInputSchema,
  get_check_in: getCheckInInputSchema,
  get_staff_availability: getStaffAvailabilityInputSchema,
} as const satisfies Record<McpWave2ReadToolName, z.ZodTypeAny>;
