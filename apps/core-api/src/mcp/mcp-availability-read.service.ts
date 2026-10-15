import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { LoanerVehiclesService } from '../loaner-vehicles/loaner-vehicles.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { WorkshopPlannerService } from '../workshop/workshop-planner.service.js';
import { WorkshopSettingsService } from '../workshop/workshop-settings.service.js';
import { parsePlannerRange } from '../workshop/workshop-planner.window.js';
import { clampMcpPageSize } from './mcp-output.util.js';
import {
  MCP_AVAILABILITY_SNAPSHOT_NOTE,
  paginateLoanerRows,
  paginateWorkshopSlotRows,
  toMcpAvailableLoanerRow,
  toMcpWorkshopSlotRow,
} from './mcp-availability-read.mapper.js';
import type {
  listAvailableLoanersInputSchema,
  listWorkshopSlotsInputSchema,
} from './mcp-tool-schemas.js';

type WorkshopSlotsInput = z.infer<typeof listWorkshopSlotsInputSchema>;
type AvailableLoanersInput = z.infer<typeof listAvailableLoanersInputSchema>;

@Injectable()
export class McpAvailabilityReadService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly workshopPlanner: WorkshopPlannerService,
    private readonly workshopSettings: WorkshopSettingsService,
    private readonly loanerVehicles: LoanerVehiclesService,
  ) {}

  async listWorkshopSlots(input: WorkshopSlotsInput) {
    const range = parsePlannerRange({ from: input.from, to: input.to });
    const siteId = await this.siteContext.getSiteId();
    const result = await this.workshopPlanner.listAvailableSlots({
      from: input.from,
      to: input.to,
      durationMinutes: input.duration_minutes,
      bayId: input.bay_id,
    });
    const pageSize = clampMcpPageSize(input.pageSize);
    const page = paginateWorkshopSlotRows(
      result.slots.map(toMcpWorkshopSlotRow),
      pageSize,
      input.cursor,
    );
    return {
      site_id: siteId,
      timezone: result.timezone,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      duration_minutes: result.durationMinutes,
      slot_minutes: result.slotMinutes,
      availability_note: MCP_AVAILABILITY_SNAPSHOT_NOTE,
      data: page.data,
      meta: page.meta,
    };
  }

  async listAvailableLoaners(input: AvailableLoanersInput) {
    const range = parsePlannerRange({ from: input.from, to: input.to });
    const [siteId, tenantId] = await Promise.all([
      this.siteContext.getSiteId(),
      this.tenantContext.getTenantId(),
    ]);
    const settings = await this.workshopSettings.getSettingsForSite(
      tenantId,
      siteId,
    );
    const availability = await this.loanerVehicles.getAvailability({
      from: input.from,
      to: input.to,
    });
    const pageSize = clampMcpPageSize(input.pageSize);
    const availableRows = availability.data
      .filter((row) => row.available)
      .map((row) =>
        toMcpAvailableLoanerRow({
          id: row.vehicle.id,
          vehicleId: row.vehicle.vehicleId,
          displayName: row.vehicle.displayName,
          status: row.vehicle.status,
        }),
      );
    const page = paginateLoanerRows(availableRows, pageSize, input.cursor);
    return {
      site_id: siteId,
      timezone: settings.timezone,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      as_of: availability.asOf,
      availability_note: MCP_AVAILABILITY_SNAPSHOT_NOTE,
      data: page.data,
      meta: page.meta,
    };
  }
}
