import {
  ImportEntityType,
  VehicleInspectionType,
  VehicleNoticeType,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import { viennaIsoDay } from '../vehicle-stock/gewaehrleistung/gewaehrleistung-status.js';
import { dateToDay } from '../vehicle/vehicle-party-date.util.js';
import { loadVehicleBoundMappings } from './canonical-csv-cell.util.js';
import { rowToRecord, type ParsedCsv } from './csv-parse.util.js';
import {
  dryRunRowNoForSlice,
  shouldStopDryRunPlanningAfterRow,
} from './import-dry-run-plan-budget.js';
import type { ImportDryRunInput } from './import-type-handler.js';
import type { DryRunRowResult } from './import.types.js';
import {
  planVehicleDueDateRows,
  type DueDateCsvRow,
  type DueDatePlanContext,
} from './vehicle-due-date-import.logic.js';

async function loadDueDatePlanContext(
  prisma: PrismaService,
  input: ImportDryRunInput,
  rows: DueDateCsvRow[],
): Promise<DueDatePlanContext> {
  const { byType, vehicleIdByExternalId, vehicleIds } =
    await loadVehicleBoundMappings(prisma, input, rows, [
      ImportEntityType.VEHICLE_DUE_DATE,
    ]);
  const { tenantId } = input;
  const [inspections, notices] = await Promise.all([
    prisma.vehicleInspectionRecord.findMany({
      where: {
        tenant_id: tenantId,
        vehicle_id: { in: vehicleIds },
        inspection_type: VehicleInspectionType.PICKERL_57A,
      },
    }),
    prisma.vehicleNotice.findMany({
      where: {
        tenant_id: tenantId,
        vehicle_id: { in: vehicleIds },
        type: VehicleNoticeType.SERVICE_DUE,
      },
    }),
  ]);
  return {
    vehicleIdByExternalId,
    dueIdByExternalId: byType(ImportEntityType.VEHICLE_DUE_DATE),
    inspections: inspections.map((record) => ({
      id: record.id,
      vehicle_id: record.vehicle_id,
      inspected_on: dateToDay(record.inspected_on) as string,
      plaketten_valid_until_year: record.plaketten_valid_until_year,
      plaketten_valid_until_month: record.plaketten_valid_until_month,
      station_name: record.station_name,
      notes: record.notes,
    })),
    serviceNotices: notices.map((notice) => ({
      id: notice.id,
      vehicle_id: notice.vehicle_id,
      external_ref: notice.external_ref,
      status: notice.status,
      body: notice.body,
      due_date: dateToDay(notice.due_date),
      due_mileage: notice.due_mileage,
    })),
    options: input.options,
    today: viennaIsoDay(new Date()),
  };
}

/** Plans every vehicle due date row of an upload, in file order. */
export async function planVehicleDueDateDryRun(
  prisma: PrismaService,
  input: ImportDryRunInput,
  parsed: ParsedCsv,
): Promise<DryRunRowResult[]> {
  const rows: { rowNo: number; record: Record<string, string> }[] = [];
  for (let index = 0; index < parsed.rows.length; index++) {
    if (shouldStopDryRunPlanningAfterRow(input.planBudget, rows.length)) {
      break;
    }
    rows.push({
      rowNo: dryRunRowNoForSlice(input.planBudget, index),
      record: rowToRecord(parsed.headers, parsed.rows[index]),
    });
    input.planBudget?.onAfterRowPlanned?.();
    if (shouldStopDryRunPlanningAfterRow(input.planBudget, rows.length)) {
      break;
    }
  }
  const context = await loadDueDatePlanContext(prisma, input, rows);
  return planVehicleDueDateRows(
    rows,
    input.mapping,
    context,
    input.reconcilePriorResults,
  );
}
