import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export const LOANER_BOOKING_FIELDS_INCOMPLETE =
  'loaner_vehicle_id, planned_from, and planned_to must be provided together';

const uuidSchema = z.string().uuid();
const isoInstantSchema = z.string().min(1);
const optionalMcpCommandIdSchema = {
  command_id: uuidSchema
    .optional()
    .describe('Optional idempotency key for MCP write replay'),
};

const loanerChargeInputSchema = z
  .object({
    unit_price_cents: z.number().int().min(0),
    quantity_days: z.number().int().positive().optional(),
  })
  .strict();

const positionLineInputSchema = z
  .object({
    preset_key: z.string().min(1).optional(),
    labor_operation_id: uuidSchema.optional(),
    catalog_item_id: uuidSchema.optional(),
    quantity_milli: z.number().int().positive().optional(),
    reserve_part: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasLabor = value.labor_operation_id !== undefined;
    const hasPart = value.catalog_item_id !== undefined;
    const hasPreset = value.preset_key !== undefined;
    if (!hasLabor && !hasPart && !hasPreset) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Each position line needs preset_key, labor_operation_id, or catalog_item_id',
      });
    }
    if (hasLabor && hasPart) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A position line cannot combine labor and catalog references',
      });
    }
  });

export const proposeWorkshopBookingInputSchema = z
  .object({
    customer_id: uuidSchema,
    vehicle_id: uuidSchema,
    bay_id: uuidSchema,
    scheduled_start_at: isoInstantSchema,
    scheduled_end_at: isoInstantSchema,
    mechanic_id: uuidSchema.optional(),
    purpose: z
      .enum(['CUSTOMER_REPAIR', 'STOCK_PREP', 'INTERNAL', 'PICKERL'])
      .optional(),
    notes: z.string().optional(),
    reported_issue: z.string().optional(),
    loaner_vehicle_id: uuidSchema.optional(),
    planned_from: isoInstantSchema.optional(),
    planned_to: isoInstantSchema.optional(),
    loaner_charge: loanerChargeInputSchema.optional(),
    position_lines: z.array(positionLineInputSchema).optional(),
    ...optionalMcpCommandIdSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasLoanerId = value.loaner_vehicle_id !== undefined;
    const hasFrom = value.planned_from !== undefined;
    const hasTo = value.planned_to !== undefined;
    if (hasLoanerId || hasFrom || hasTo) {
      if (!hasLoanerId || !hasFrom || !hasTo) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'loaner_vehicle_id, planned_from, and planned_to must be provided together',
        });
      }
    }
    if (value.loaner_charge !== undefined && !hasLoanerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'loaner_charge requires a complete loaner booking',
      });
    }
  });

export type NormalizedWorkshopBookingPackage = {
  customerId: string;
  vehicleId: string;
  bayId: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  mechanicId?: string;
  purpose?: 'CUSTOMER_REPAIR' | 'STOCK_PREP' | 'INTERNAL' | 'PICKERL';
  notes?: string;
  reportedIssue?: string;
  loaner?: {
    loanerVehicleId: string;
    plannedFrom: string;
    plannedTo: string;
  };
  loanerCharge?: {
    unitPriceCents: number;
    quantityDays?: number;
  };
  positionPlanLineCount: number;
};

function readPositionPlanLineCount(record: Record<string, unknown>): number {
  const positionPlan = record.position_plan;
  if (
    !positionPlan ||
    typeof positionPlan !== 'object' ||
    Array.isArray(positionPlan)
  ) {
    return 0;
  }
  const lines = (positionPlan as Record<string, unknown>).lines;
  return Array.isArray(lines) ? lines.length : 0;
}

function readScheduleTimes(record: Record<string, unknown>): {
  start?: string;
  end?: string;
} {
  const schedule = record.schedule;
  if (schedule && typeof schedule === 'object' && !Array.isArray(schedule)) {
    const scheduleRecord = schedule as Record<string, unknown>;
    const start =
      typeof scheduleRecord.start_at === 'string'
        ? scheduleRecord.start_at
        : undefined;
    const end =
      typeof scheduleRecord.end_at === 'string'
        ? scheduleRecord.end_at
        : undefined;
    return { start, end };
  }
  const start =
    typeof record.scheduled_start_at === 'string'
      ? record.scheduled_start_at
      : undefined;
  const end =
    typeof record.scheduled_end_at === 'string'
      ? record.scheduled_end_at
      : undefined;
  return { start, end };
}

function resolveLoanerCharge(
  record: Record<string, unknown>,
): NormalizedWorkshopBookingPackage['loanerCharge'] {
  const charge = record.loaner_charge;
  if (!charge || typeof charge !== 'object' || Array.isArray(charge)) {
    return undefined;
  }
  const chargeRecord = charge as Record<string, unknown>;
  const unitPriceCents = chargeRecord.unit_price_cents;
  if (typeof unitPriceCents !== 'number' || !Number.isInteger(unitPriceCents)) {
    return undefined;
  }
  const quantityDays = chargeRecord.quantity_days;
  return {
    unitPriceCents,
    quantityDays:
      typeof quantityDays === 'number' && Number.isInteger(quantityDays)
        ? quantityDays
        : undefined,
  };
}

function resolveLoaner(
  record: Record<string, unknown>,
): NormalizedWorkshopBookingPackage['loaner'] {
  const loanerBlock = record.loaner;
  if (
    loanerBlock &&
    typeof loanerBlock === 'object' &&
    !Array.isArray(loanerBlock)
  ) {
    const loanerRecord = loanerBlock as Record<string, unknown>;
    if (loanerRecord.requested === false) {
      return undefined;
    }
    const loanerVehicleId =
      typeof loanerRecord.loaner_vehicle_id === 'string'
        ? loanerRecord.loaner_vehicle_id
        : undefined;
    const plannedFrom =
      typeof loanerRecord.planned_from === 'string'
        ? loanerRecord.planned_from
        : undefined;
    const plannedTo =
      typeof loanerRecord.planned_to === 'string'
        ? loanerRecord.planned_to
        : undefined;
    const anyBlockField = loanerVehicleId || plannedFrom || plannedTo;
    const requested = loanerRecord.requested === true;
    if (requested || anyBlockField) {
      if (!loanerVehicleId || !plannedFrom || !plannedTo) {
        throw new BadRequestException(LOANER_BOOKING_FIELDS_INCOMPLETE);
      }
      return { loanerVehicleId, plannedFrom, plannedTo };
    }
  }

  const loanerVehicleId =
    typeof record.loaner_vehicle_id === 'string'
      ? record.loaner_vehicle_id
      : undefined;
  const plannedFrom =
    typeof record.planned_from === 'string' ? record.planned_from : undefined;
  const plannedTo =
    typeof record.planned_to === 'string' ? record.planned_to : undefined;
  const anyTopLevelField = loanerVehicleId || plannedFrom || plannedTo;
  if (anyTopLevelField) {
    if (!loanerVehicleId || !plannedFrom || !plannedTo) {
      throw new BadRequestException(LOANER_BOOKING_FIELDS_INCOMPLETE);
    }
    return { loanerVehicleId, plannedFrom, plannedTo };
  }
  return undefined;
}

/** Accepts MCP tool args or a stored WorkshopIntent-style booking package payload. */
export function normalizeWorkshopBookingPackage(
  input: unknown,
): NormalizedWorkshopBookingPackage {
  const parsedMcp = proposeWorkshopBookingInputSchema.safeParse(input);
  if (parsedMcp.success) {
    const value = parsedMcp.data;
    return {
      customerId: value.customer_id,
      vehicleId: value.vehicle_id,
      bayId: value.bay_id,
      scheduledStartAt: value.scheduled_start_at,
      scheduledEndAt: value.scheduled_end_at,
      mechanicId: value.mechanic_id,
      purpose: value.purpose,
      notes: value.notes,
      reportedIssue: value.reported_issue,
      loaner:
        value.loaner_vehicle_id && value.planned_from && value.planned_to
          ? {
              loanerVehicleId: value.loaner_vehicle_id,
              plannedFrom: value.planned_from,
              plannedTo: value.planned_to,
            }
          : undefined,
      loanerCharge: value.loaner_charge
        ? {
            unitPriceCents: value.loaner_charge.unit_price_cents,
            quantityDays: value.loaner_charge.quantity_days,
          }
        : undefined,
      positionPlanLineCount: Array.isArray(value.position_lines)
        ? value.position_lines.length
        : 0,
    };
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw parsedMcp.error;
  }
  const record = input as Record<string, unknown>;
  const customerId =
    typeof record.customer_id === 'string' ? record.customer_id : '';
  const vehicleId =
    typeof record.vehicle_id === 'string' ? record.vehicle_id : '';
  const bayId = typeof record.bay_id === 'string' ? record.bay_id : '';
  const { start, end } = readScheduleTimes(record);
  if (!customerId || !vehicleId || !bayId || !start || !end) {
    throw parsedMcp.error;
  }

  const purposeValue = record.purpose ?? record.order_status;
  const purpose =
    purposeValue === 'CUSTOMER_REPAIR' ||
    purposeValue === 'STOCK_PREP' ||
    purposeValue === 'INTERNAL' ||
    purposeValue === 'PICKERL'
      ? purposeValue
      : undefined;

  return {
    customerId,
    vehicleId,
    bayId,
    scheduledStartAt: start,
    scheduledEndAt: end,
    mechanicId:
      typeof record.mechanic_id === 'string' ? record.mechanic_id : undefined,
    purpose,
    notes: typeof record.notes === 'string' ? record.notes : undefined,
    reportedIssue:
      typeof record.reported_issue === 'string'
        ? record.reported_issue
        : undefined,
    loaner: resolveLoaner(record),
    loanerCharge: resolveLoanerCharge(record),
    positionPlanLineCount: readPositionPlanLineCount(record),
  };
}
