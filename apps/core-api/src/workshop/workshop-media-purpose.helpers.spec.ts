import { WorkshopMediaPurpose } from '@prisma/client';
import {
  MECHANIC_FINDING_MEDIA_PURPOSES,
  WORKSHOP_CHECK_IN_MEDIA_PURPOSES,
  mechanicFindingMediaPurposeFilter,
} from './workshop-media-purpose.helpers.js';

describe('workshop-media-purpose helpers', () => {
  it('keeps mechanic finding media on GENERAL only', () => {
    expect(MECHANIC_FINDING_MEDIA_PURPOSES).toEqual([
      WorkshopMediaPurpose.GENERAL,
    ]);
    expect(mechanicFindingMediaPurposeFilter()).toEqual({
      in: [WorkshopMediaPurpose.GENERAL],
    });
    expect(WORKSHOP_CHECK_IN_MEDIA_PURPOSES.has(WorkshopMediaPurpose.CHECK_IN)).toBe(
      true,
    );
    expect(
      WORKSHOP_CHECK_IN_MEDIA_PURPOSES.has(WorkshopMediaPurpose.GENERAL),
    ).toBe(false);
  });
});
