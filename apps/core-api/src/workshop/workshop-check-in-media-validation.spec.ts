import { UnprocessableEntityException } from '@nestjs/common';
import { assertCheckInDamageMarkerMediaIds } from './workshop-check-in-media-validation.js';

describe('assertCheckInDamageMarkerMediaIds', () => {
  const db = {
    workshopMedia: {
      findMany: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts media ids that belong to this check-in', async () => {
    db.workshopMedia.findMany.mockResolvedValue([
      { id: '51500000-0000-4000-8000-000000000601' },
    ]);

    await assertCheckInDamageMarkerMediaIds(
      db as never,
      'tenant-1',
      'check-in-1',
      [
        {
          id: '51500000-0000-4000-8000-000000000600',
          zone_id: 'BONNET',
          type: 'SCRATCH',
          note: 'Paint chip',
          media_ids: ['51500000-0000-4000-8000-000000000601'],
        },
      ],
    );

    expect(db.workshopMedia.findMany).toHaveBeenCalledTimes(1);
  });

  it('rejects foreign media ids', async () => {
    db.workshopMedia.findMany.mockResolvedValue([]);

    await expect(
      assertCheckInDamageMarkerMediaIds(db as never, 'tenant-1', 'check-in-1', [
        {
          id: '51500000-0000-4000-8000-000000000600',
          zone_id: 'BONNET',
          type: 'SCRATCH',
          note: 'Paint chip',
          media_ids: ['51500000-0000-4000-8000-000000000602'],
        },
      ]),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
