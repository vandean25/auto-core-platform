import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export const WARRANTY_CLAIM_LINE_REFERENCED_CODE =
  'WARRANTY_CLAIM_LINE_REFERENCED';

/**
 * A line on a warranty claim stays on the order for the audit trail (AUT-464). The claim holds a
 * RESTRICT reference to the line, so a hard delete would fail deep in the database. This refuses the
 * delete up front with a message the advisor can act on.
 */
export async function assertNoWarrantyClaimLines(
  tx: Prisma.TransactionClient,
  where: Prisma.WarrantyClaimLineWhereInput,
): Promise<void> {
  const claimed = await tx.warrantyClaimLine.findFirst({
    where,
    select: { warranty_claim: { select: { status: true } } },
  });
  if (!claimed) return;

  throw new ConflictException({
    code: WARRANTY_CLAIM_LINE_REFERENCED_CODE,
    message:
      claimed.warranty_claim.status === 'DRAFT'
        ? 'A line is on a draft warranty claim. Remove it from the claim before deleting it.'
        : 'A line is on a warranty claim that has left draft. Claimed lines stay on the order for the audit trail.',
  });
}
