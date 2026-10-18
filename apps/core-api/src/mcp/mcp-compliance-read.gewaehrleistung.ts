import type { z } from 'zod';
import type { VehicleStockQueryService } from '../vehicle-stock/vehicle-stock-query.service.js';
import { toMcpGewaehrleistungDueRow } from './mcp-compliance-read.mapper.js';
import { offsetFromCursor, toMcpPageMeta } from './mcp-report-read.mapper.js';
import { clampMcpPageSize } from './mcp-output.util.js';
import type { listGewaehrleistungDueInputSchema } from './mcp-tool-schemas.js';

type GewaehrleistungDueInput = z.infer<
  typeof listGewaehrleistungDueInputSchema
>;

const DEFAULT_WITHIN_DAYS = 30;

export async function mcpListGewaehrleistungDue(
  vehicleStock: VehicleStockQueryService,
  input: GewaehrleistungDueInput,
) {
  const withinDays = input.within_days ?? DEFAULT_WITHIN_DAYS;
  const scope = {
    offset: offsetFromCursor(input.cursor),
    pageSize: clampMcpPageSize(input.pageSize),
  };
  const report = await vehicleStock.listGewaehrleistungDue({
    endsWithinDays: withinDays,
  });
  const rows = report.data;
  return {
    within_days: withinDays,
    data: rows
      .slice(scope.offset, scope.offset + scope.pageSize)
      .map(toMcpGewaehrleistungDueRow),
    meta: toMcpPageMeta(rows.length, scope),
  };
}
