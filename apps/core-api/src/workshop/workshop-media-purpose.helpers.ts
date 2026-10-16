import { WorkshopMediaPurpose } from '@prisma/client';
import type { Prisma } from '@prisma/client';

/** Purposes attached to tablet check-in evidence, not mechanic task uploads. */
export const WORKSHOP_CHECK_IN_MEDIA_PURPOSES: ReadonlySet<WorkshopMediaPurpose> =
  new Set([
    WorkshopMediaPurpose.CHECK_IN,
    WorkshopMediaPurpose.CHECK_IN_SIGNATURE,
  ]);

/** Media purposes eligible for AUT-538 mechanic finding attachment. */
export const MECHANIC_FINDING_MEDIA_PURPOSES: WorkshopMediaPurpose[] = [
  WorkshopMediaPurpose.GENERAL,
];

export function mechanicFindingMediaPurposeFilter(): Prisma.EnumWorkshopMediaPurposeFilter {
  return { in: MECHANIC_FINDING_MEDIA_PURPOSES };
}
