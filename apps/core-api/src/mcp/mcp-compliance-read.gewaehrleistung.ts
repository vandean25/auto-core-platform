import type { z } from 'zod';
import type { GewaehrleistungDueListReadService } from '../vehicle-stock/gewaehrleistung/gewaehrleistung-due-list.read.js';
import { toMcpGewaehrleistungDueRow } from './mcp-compliance-read.mapper.js';
import { offsetFromCursor, toMcpPageMeta } from './mcp-report-read.mapper.js';
import { clampMcpPageSize } from './mcp-output.util.js';
import type { listGewaehrleistungDueInputSchema } from './mcp-tool-schemas.compliance-reads.js';

type GewaehrleistungDueInput = z.infer<
  typeof listGewaehrleistungDueInputSchema
>;

const DEFAULT_WITHIN_DAYS = 30;

export async function mcpListGewaehrleistungDue(
  gewaehrleistungDueList: GewaehrleistungDueListReadService,
  input: GewaehrleistungDueInput,
) {
  const withinDays = input.within_days ?? DEFAULT_WITHIN_DAYS;
  const scope = {
    offset: offsetFromCursor(input.cursor),
    pageSize: clampMcpPageSize(input.pageSize),
  };
  const report = await gewaehrleistungDueList.list({
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
