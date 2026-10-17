import { deleteCheckInStoredPhotoIfUnreferenced } from './workshop-check-in-media-storage-cleanup.js';

describe('deleteCheckInStoredPhotoIfUnreferenced', () => {
  it('skips delete when a workshop_media row still references the object key', async () => {
    const deleteObjectIfExists = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      workshopMedia: {
        findFirst: jest.fn().mockResolvedValue({ id: 'media-1' }),
      },
    };

    await deleteCheckInStoredPhotoIfUnreferenced(
      prisma as never,
      { deleteObjectIfExists } as never,
      'tenant-1',
      'bucket',
      'key.jpg',
    );

    expect(deleteObjectIfExists).not.toHaveBeenCalled();
  });

  it('deletes when no row references the object key', async () => {
    const deleteObjectIfExists = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      workshopMedia: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    await deleteCheckInStoredPhotoIfUnreferenced(
      prisma as never,
      { deleteObjectIfExists } as never,
      'tenant-1',
      'bucket',
      'key.jpg',
    );

    expect(deleteObjectIfExists).toHaveBeenCalledWith('bucket', 'key.jpg');
  });
});
