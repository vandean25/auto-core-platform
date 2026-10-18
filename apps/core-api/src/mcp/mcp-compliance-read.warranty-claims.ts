import type { WarrantyClaimStatus } from '@prisma/client';
import type { z } from 'zod';
import type { WarrantyClaimSiteListService } from '../warranty-claim/warranty-claim-site-list.service.js';
import {
  toMcpWarrantyClaimListRow,
  warrantyClaimKeysetCursorOf,
} from './mcp-compliance-read.mapper.js';
import {
  decodeMcpKeysetCursor,
  encodeMcpKeysetCursor,
} from './mcp-output.util.js';
import type { listWarrantyClaimsInputSchema } from './mcp-tool-schemas.js';

type WarrantyClaimsInput = z.infer<typeof listWarrantyClaimsInputSchema>;

export async function mcpListWarrantyClaims(
  warrantyClaimSiteList: WarrantyClaimSiteListService,
  input: WarrantyClaimsInput,
  pageSize: number,
) {
  const cursor = input.cursor ? decodeMcpKeysetCursor(input.cursor) : undefined;
  const statuses: WarrantyClaimStatus[] | undefined = input.status
    ? [input.status]
    : undefined;

  const { rows, total } = await warrantyClaimSiteList.listAtActiveSite({
    workshopOrderId: input.order_id,
    statuses,
    type: input.type,
    pageSize,
    cursorCreatedAt: cursor ? new Date(cursor.at) : undefined,
    cursorId: cursor?.id,
  });

  const hasMore = rows.length > pageSize;
  const page = rows.slice(0, pageSize).map(toMcpWarrantyClaimListRow);
  const last = page[page.length - 1];
  return {
    data: page,
    meta: {
      total,
      page_size: pageSize,
      next_cursor:
        hasMore && last
          ? encodeMcpKeysetCursor(
              warrantyClaimKeysetCursorOf(last.created_at, last.id),
            )
          : null,
    },
  };
}
