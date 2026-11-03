import type { Prisma } from '@prisma/client';

export const TRANSFER_INCLUDE = {
  from_site: { select: { name: true } },
  to_site: { select: { name: true } },
  lines: {
    orderBy: { createdAt: 'asc' as const },
    // AUT-909: bins resolve inside the transfer query so detail and list stay
    // a constant number of statements regardless of line count.
    include: {
      source_location: { select: { code: true, name: true } },
      dest_location: { select: { code: true, name: true } },
    },
  },
} satisfies Prisma.StockTransferInclude;
