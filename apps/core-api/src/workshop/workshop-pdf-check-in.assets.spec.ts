import { WorkshopMediaPurpose } from '@prisma/client';
import { embedWorkshopCheckInPdfMedia } from './workshop-pdf-check-in.assets.js';
import {
  buildWorkshopPdfFixtureCheckInSnapshot,
  CHECK_IN_FIXTURE_SIGNATURE_SHA256,
  CHECK_IN_PHOTO_DATA_URL,
  CHECK_IN_SIGNATURE_DATA_URL,
} from './workshop-pdf.fixture.js';

describe('embedWorkshopCheckInPdfMedia', () => {
  const tenantId = 'tenant-fixture';
  const checkInId = 'check-in-pdf-fixture';

  it('loads CHECK_IN photos from the frozen snapshot and signature from WorkshopMedia', async () => {
    const snapshot = buildWorkshopPdfFixtureCheckInSnapshot();
    expect(snapshot.media.some((m) => m.id === 'sig-1')).toBe(false);

    const mediaStorage = {
      readObjectBytes: jest
        .fn()
        .mockImplementation(async (_bucket: string, key: string) => {
          if (key === 'photo-1.jpg') {
            return Buffer.from('jpeg-photo-fixture');
          }
          if (key === 'sig-1.png') {
            return Buffer.from('signature-png-fixture');
          }
          throw new Error(`unexpected key ${key}`);
        }),
    };

    const prisma = {
      workshopMedia: {
        findFirst: jest.fn().mockResolvedValue({
          storage_bucket: 'media-bucket',
          storage_key: 'sig-1.png',
          mime_type: 'image/png',
        }),
      },
    };

    const embedded = await embedWorkshopCheckInPdfMedia(
      { mediaStorage, prisma, tenantId, checkInId },
      snapshot,
    );

    expect(prisma.workshopMedia.findFirst).toHaveBeenCalledWith({
      where: {
        tenant_id: tenantId,
        id: snapshot.signature.media_id,
        check_in_id: checkInId,
        purpose: WorkshopMediaPurpose.CHECK_IN_SIGNATURE,
      },
      select: {
        storage_bucket: true,
        storage_key: true,
        mime_type: true,
      },
    });
    expect(embedded.photoDataUrls['photo-1']).toBe(CHECK_IN_PHOTO_DATA_URL);
    expect(embedded.signatureDataUrl).toBe(CHECK_IN_SIGNATURE_DATA_URL);
    expect(snapshot.signature.content_sha256).toBe(
      CHECK_IN_FIXTURE_SIGNATURE_SHA256,
    );
  });

  it('rejects signature bytes that do not match the frozen digest', async () => {
    const snapshot = buildWorkshopPdfFixtureCheckInSnapshot();
    const mediaStorage = {
      readObjectBytes: jest.fn().mockResolvedValue(Buffer.from('wrong-bytes')),
    };
    const prisma = {
      workshopMedia: {
        findFirst: jest.fn().mockResolvedValue({
          storage_bucket: 'media-bucket',
          storage_key: 'sig-1.png',
          mime_type: 'image/png',
        }),
      },
    };

    await expect(
      embedWorkshopCheckInPdfMedia(
        { mediaStorage, prisma, tenantId, checkInId },
        snapshot,
      ),
    ).rejects.toThrow('do not match frozen evidence digest');
  });
});
