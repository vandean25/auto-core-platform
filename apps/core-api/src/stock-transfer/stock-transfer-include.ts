import type { Prisma } from '@prisma/client';

export const TRANSFER_INCLUDE = {
  from_site: { select: { name: true } },
  to_site: { select: { name: true } },
  lines: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.StockTransferInclude;
