import type { TyreSetResponseDto } from '../tyre-storage/dto/tyre-set.dto.js';
import type { TyreSetListReadService } from '../tyre-storage/tyre-set-list-read.service.js';
import type { TyreStorageService } from '../tyre-storage/tyre-storage.service.js';
import { toMcpTyreSetRow } from './mcp-compliance-read.mapper.js';
import { toMcpPageMeta } from './mcp-report-read.mapper.js';
import { encodeMcpCursor } from './mcp-output.util.js';
import type { listTyreSetsInputSchema } from './mcp-tool-schemas.js';
import type { z } from 'zod';

type TyreSetsInput = z.infer<typeof listTyreSetsInputSchema>;

export async function mcpListTyreSets(
  tyreStorage: TyreStorageService,
  tyreSetListRead: TyreSetListReadService,
  input: TyreSetsInput,
  pageSize: number,
  offset: number,
) {
  if (input.due_for_swap) {
    const due = await tyreStorage.listDueForSwap();
    let rows: TyreSetResponseDto[] = due.data;
    if (input.customer_id) {
      rows = rows.filter((row) => row.customerId === input.customer_id);
    }
    if (input.vehicle_id) {
      rows = rows.filter((row) => row.vehicleId === input.vehicle_id);
    }
    if (input.status) {
      rows = rows.filter((row) => row.status === input.status);
    }
    const pageRows = rows.slice(offset, offset + pageSize);
    return {
      data: pageRows.map(toMcpTyreSetRow),
      meta: toMcpPageMeta(rows.length, { offset, pageSize }),
    };
  }

  const listed = await tyreSetListRead.list({
    customerId: input.customer_id,
    vehicleId: input.vehicle_id,
    status: input.status,
    skip: offset,
    pageSize: pageSize + 1,
  });
  const hasMore = listed.data.length > pageSize;
  const pageRows = listed.data.slice(0, pageSize);
  return {
    data: pageRows.map(toMcpTyreSetRow),
    meta: {
      total: listed.meta.total,
      page_size: pageSize,
      next_cursor: hasMore ? encodeMcpCursor(offset + pageSize) : null,
    },
  };
}
