import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, WorkshopMediaPurpose } from '@prisma/client';
import type { CheckInDamageMarkerDto } from './dto/workshop-check-in.dto.js';
import { CHECK_IN_ERROR_CODES } from './workshop-check-in.rules.js';
import { assertCheckInDraftForMutation } from './workshop-check-in-immutability.js';

export { assertMcpWorkshopMediaUploadDeclared } from './workshop-mcp-media-validation.js';

type CheckInDb = Pick<
  Prisma.TransactionClient,
  'workshopMedia' | 'workshopCheckIn'
>;

/**
 * Call at the start of every transaction that attaches or updates check-in media
 * (`check_in_id` set, purpose CHECK_IN / CHECK_IN_SIGNATURE).
 */
export async function assertCheckInAllowsMediaMutation(
  db: CheckInDb,
  tenantId: string,
  checkInId: string,
): Promise<void> {
  const row = await db.workshopCheckIn.findFirst({
    where: { tenant_id: tenantId, id: checkInId },
    select: { status: true },
  });
  if (!row) {
    throw new NotFoundException('Workshop check-in not found');
  }
  assertCheckInDraftForMutation(row.status);
}

export async function assertCheckInAllowsMediaDetach(
  db: CheckInDb,
  tenantId: string,
  checkInId: string,
): Promise<void> {
  await assertCheckInAllowsMediaMutation(db, tenantId, checkInId);
}

export async function assertCheckInDamageMarkerMediaIds(
  db: CheckInDb,
  tenantId: string,
  checkInId: string,
  markers: CheckInDamageMarkerDto[],
): Promise<void> {
  const requestedIds = [
    ...new Set(markers.flatMap((marker) => marker.media_ids)),
  ];
  if (requestedIds.length === 0) {
    return;
  }

  const allowedRows = await db.workshopMedia.findMany({
    where: {
      tenant_id: tenantId,
      check_in_id: checkInId,
      purpose: WorkshopMediaPurpose.CHECK_IN,
      id: { in: requestedIds },
    },
    select: { id: true },
  });

  if (allowedRows.length !== requestedIds.length) {
    throw new UnprocessableEntityException({
      code: CHECK_IN_ERROR_CODES.CHECK_IN_MEDIA_INVALID,
      message:
        'Damage marker photo ids must reference CHECK_IN media on this check-in.',
    });
  }
}
