import { BadRequestException, Injectable } from '@nestjs/common';
import { WorkshopEstimateStatus } from '@prisma/client';
import type { z } from 'zod';
import { LoanerVehiclesService } from '../loaner-vehicles/loaner-vehicles.service.js';
import { getLoanerNow } from '../loaner-vehicles/loaner-clock.js';
import type { LoanerBookingResponse } from '../loaner-vehicles/loaner.mapper.js';
import { HrStaffAvailabilityService } from '../hr/hr-staff-availability.service.js';
import { WorkshopCheckInService } from '../workshop/workshop-check-in.service.js';
import { WorkshopCheckInMediaService } from '../workshop/workshop-check-in-media.service.js';
import { WorkshopEstimateService } from '../workshop/workshop-estimate.service.js';
import { WorkshopInspectionService } from '../workshop/workshop-inspection.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { clampMcpPageSize } from './mcp-output.util.js';
import {
  isLoanerBookingOverdue,
  paginateCommunications,
  paginateEstimateVersions,
  paginateLoanerBookings,
  toMcpCheckInSummary,
  toMcpEstimateVersionRow,
  toMcpLoanerBookingRow,
  toMcpOrderCommunicationRow,
} from './mcp-wave2-read.mapper.js';
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
    private readonly loaners: LoanerVehiclesService,
    private readonly estimates: WorkshopEstimateService,
    private readonly checkIns: WorkshopCheckInService,
    private readonly checkInMedia: WorkshopCheckInMediaService,
    private readonly inspections: WorkshopInspectionService,
    private readonly staffAvailability: HrStaffAvailabilityService,
    private readonly siteContext: SiteContextService,
  ) {}

  async listLoanerBookings(
    input: z.infer<typeof listLoanerBookingsInputSchema>,
  ) {
    const pageSize = clampMcpPageSize(input.pageSize);
    const asOf = getLoanerNow();
    const siteId = await this.siteContext.getSiteId();

    const base = input.overdueOnly
      ? (await this.loaners.listOverdue()).data
      : (await this.loaners.listBookings()).data;

    const filtered = this.filterLoanerBookings(base, input, asOf).sort(
      (left, right) =>
        right.plannedFrom.getTime() - left.plannedFrom.getTime() ||
        right.id.localeCompare(left.id),
    );

    const mapped = filtered.map((row) => toMcpLoanerBookingRow(row, asOf));
    const page = paginateLoanerBookings(mapped, pageSize, input.cursor);
    return { site_id: siteId, as_of: asOf.toISOString(), ...page };
  }

  async listEstimates(input: z.infer<typeof listEstimatesInputSchema>) {
    const pageSize = clampMcpPageSize(input.pageSize);
    const siteId = await this.siteContext.getSiteId();
    const rows = await this.estimates.listVersionsForSite({
      customerId: input.customerId,
      orderId: input.orderId,
      status: input.status as WorkshopEstimateStatus | undefined,
      sentFrom: input.sentFrom,
      sentTo: input.sentTo,
    });
    const mapped = rows.map(toMcpEstimateVersionRow);
    const page = paginateEstimateVersions(mapped, pageSize, input.cursor);
    return { site_id: siteId, ...page };
  }

  async listOrderCommunications(
    input: z.infer<typeof listOrderCommunicationsInputSchema>,
  ) {
    const pageSize = clampMcpPageSize(input.pageSize);
    const siteId = await this.siteContext.getSiteId();
    const { data } = await this.estimates.listCommunicationsForOrder(
      input.orderId,
    );
    const mapped = data.map(toMcpOrderCommunicationRow);
    const page = paginateCommunications(mapped, pageSize, input.cursor);
    return { site_id: siteId, order_id: input.orderId, ...page };
  }

  async getCheckIn(input: z.infer<typeof getCheckInInputSchema>) {
    const siteId = await this.siteContext.getSiteId();
    const checkIn = await this.checkIns.get(input.orderId);
    const [checklist, media] = await Promise.all([
      this.inspections
        .getOrderCheckInChecklist(input.orderId)
        .then((response) => response.items ?? [])
        .catch(() => []),
      this.checkInMedia
        .list(input.orderId)
        .then((response) => response.data ?? [])
        .catch(() => []),
    ]);
    return {
      site_id: siteId,
      order_id: input.orderId,
      ...toMcpCheckInSummary(checkIn, checklist, media),
    };
  }

  getStaffAvailability(input: z.infer<typeof getStaffAvailabilityInputSchema>) {
    return this.staffAvailability.getStaffAvailability({
      date: input.date,
      siteId: input.siteId,
      role: input.role,
    });
  }

  private filterLoanerBookings(
    rows: LoanerBookingResponse[],
    input: z.infer<typeof listLoanerBookingsInputSchema>,
    asOf: Date,
  ): LoanerBookingResponse[] {
    if (input.from && input.to && input.from > input.to) {
      throw new BadRequestException('from must not be after to');
    }
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
      if (fromMs !== null && row.plannedFrom.getTime() < fromMs) {
        return false;
      }
      if (toMs !== null && row.plannedTo.getTime() > toMs) {
        return false;
      }
      return true;
    });
  }
}
