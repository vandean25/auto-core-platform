import { NotFoundException } from '@nestjs/common';
import type { z } from 'zod';
import { getLoanerNow } from '../loaner-vehicles/loaner-clock.js';
import type { LoanerBookingResponse } from '../loaner-vehicles/loaner.mapper.js';
import { LoanerVehiclesService } from '../loaner-vehicles/loaner-vehicles.service.js';
import { HrStaffAvailabilityService } from '../hr/hr-staff-availability.service.js';
import { WorkshopCheckInService } from '../workshop/workshop-check-in.service.js';
import { WorkshopCheckInMediaService } from '../workshop/workshop-check-in-media.service.js';
import { WorkshopEstimateService } from '../workshop/workshop-estimate.service.js';
import { WorkshopEstimateSiteVersionListService } from '../workshop/workshop-estimate-site-version-list.service.js';
import { WorkshopInspectionService } from '../workshop/workshop-inspection.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { clampMcpPageSize } from './mcp-output.util.js';
import {
  paginateCommunications,
  paginateLoanerBookings,
  toMcpCheckInSummary,
  toMcpEstimateVersionRow,
  toMcpLoanerBookingRow,
  toMcpOrderCommunicationRow,
  isLoanerBookingOverdue,
} from './mcp-wave2-read.mapper.js';
import type {
  getCheckInInputSchema,
  getStaffAvailabilityInputSchema,
  listEstimatesInputSchema,
  listLoanerBookingsInputSchema,
  listOrderCommunicationsInputSchema,
} from './mcp-read-wave2-schemas.js';

export function filterLoanerBookings(
  rows: LoanerBookingResponse[],
  input: z.infer<typeof listLoanerBookingsInputSchema>,
  asOf: Date,
): LoanerBookingResponse[] {
  const fromMs = input.from ? Date.parse(input.from) : null;
  const toMs = input.to ? Date.parse(input.to) : null;

  return rows.filter((row) => {
    if (input.status && row.status !== input.status) {
      return false;
    }
    if (input.loanerId && row.loanerVehicleId !== input.loanerId) {
      return false;
    }
    if (input.customerId && row.customerId !== input.customerId) {
      return false;
    }
    if (input.orderId && row.workshopOrderId !== input.orderId) {
      return false;
    }
    if (input.overdueOnly && !isLoanerBookingOverdue(row, asOf)) {
      return false;
    }
    if (fromMs !== null && row.plannedTo.getTime() < fromMs) {
      return false;
    }
    if (toMs !== null && row.plannedFrom.getTime() > toMs) {
      return false;
    }
    return true;
  });
}

export async function loadChecklistItems(
  inspections: WorkshopInspectionService,
  orderId: string,
) {
  try {
    const response = await inspections.getOrderCheckInChecklist(orderId);
    return response.items ?? [];
  } catch (error) {
    if (error instanceof NotFoundException) {
      return [];
    }
    throw error;
  }
}

export async function loadCheckInMedia(
  checkInMedia: WorkshopCheckInMediaService,
  orderId: string,
) {
  try {
    const response = await checkInMedia.list(orderId);
    return response.data ?? [];
  } catch (error) {
    if (error instanceof NotFoundException) {
      return [];
    }
    throw error;
  }
}

export async function runListLoanerBookings(
  deps: { loaners: LoanerVehiclesService; siteContext: SiteContextService },
  input: z.infer<typeof listLoanerBookingsInputSchema>,
) {
  const pageSize = clampMcpPageSize(input.pageSize);
  const asOf = getLoanerNow();
  const siteId = await deps.siteContext.getSiteId();
  const base = input.overdueOnly
    ? (await deps.loaners.listOverdue()).data
    : (await deps.loaners.listBookings()).data;
  const filtered = filterLoanerBookings(base, input, asOf).sort(
    (left, right) =>
      right.plannedFrom.getTime() - left.plannedFrom.getTime() ||
      right.id.localeCompare(left.id),
  );
  const mapped = filtered.map((row) => toMcpLoanerBookingRow(row, asOf));
  const page = paginateLoanerBookings(mapped, pageSize, input.cursor);
  return { site_id: siteId, as_of: asOf.toISOString(), ...page };
}

export async function runListEstimates(
  deps: {
    estimateSiteVersions: WorkshopEstimateSiteVersionListService;
    siteContext: SiteContextService;
  },
  input: z.infer<typeof listEstimatesInputSchema>,
) {
  const pageSize = clampMcpPageSize(input.pageSize);
  const siteId = await deps.siteContext.getSiteId();
  const { rows, nextCursor } = await deps.estimateSiteVersions.listPage({
    customerId: input.customerId,
    orderId: input.orderId,
    status: input.status,
    sentFrom: input.sentFrom,
    sentTo: input.sentTo,
    pageSize,
    cursor: input.cursor,
  });
  return {
    site_id: siteId,
    data: rows.map(toMcpEstimateVersionRow),
    meta: { page_size: pageSize, next_cursor: nextCursor },
  };
}

export async function runListOrderCommunications(
  deps: {
    estimates: WorkshopEstimateService;
    siteContext: SiteContextService;
  },
  input: z.infer<typeof listOrderCommunicationsInputSchema>,
) {
  const pageSize = clampMcpPageSize(input.pageSize);
  const siteId = await deps.siteContext.getSiteId();
  const { data } = await deps.estimates.listCommunicationsForOrder(
    input.orderId,
  );
  const mapped = data.map(toMcpOrderCommunicationRow);
  const page = paginateCommunications(mapped, pageSize, input.cursor);
  return { site_id: siteId, order_id: input.orderId, ...page };
}

export async function runGetCheckIn(
  deps: {
    checkIns: WorkshopCheckInService;
    checkInMedia: WorkshopCheckInMediaService;
    inspections: WorkshopInspectionService;
    siteContext: SiteContextService;
  },
  input: z.infer<typeof getCheckInInputSchema>,
) {
  const siteId = await deps.siteContext.getSiteId();
  const checkIn = await deps.checkIns.get(input.orderId);
  const [checklist, media] = await Promise.all([
    loadChecklistItems(deps.inspections, input.orderId),
    loadCheckInMedia(deps.checkInMedia, input.orderId),
  ]);
  return {
    site_id: siteId,
    order_id: input.orderId,
    ...toMcpCheckInSummary(checkIn, checklist, media),
  };
}

export function runGetStaffAvailability(
  deps: { staffAvailability: HrStaffAvailabilityService },
  input: z.infer<typeof getStaffAvailabilityInputSchema>,
) {
  return deps.staffAvailability.getStaffAvailability({
    date: input.date,
    siteId: input.siteId,
    role: input.role,
  });
}
