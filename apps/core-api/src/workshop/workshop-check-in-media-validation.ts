import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma, WorkshopMediaPurpose } from '@prisma/client';
import type { CheckInDamageMarkerDto } from './dto/workshop-check-in.dto.js';
import { CHECK_IN_ERROR_CODES } from './workshop-check-in.rules.js';

export {
  assertMcpWorkshopMediaUploadDeclared,
  MCP_WORKSHOP_MEDIA_UPLOAD_MIME_TYPES,
  MCP_WORKSHOP_MEDIA_UPLOAD_PURPOSES,
  resolveMcpWorkshopMediaPurpose,
  type McpWorkshopMediaUploadMimeType,
  type McpWorkshopMediaUploadPurpose,
} from './workshop-mcp-media-validation.js';

type CheckInDb = Pick<Prisma.TransactionClient, 'workshopMedia'>;

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
