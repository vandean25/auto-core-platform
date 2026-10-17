import { WorkshopCheckInStatus } from '@prisma/client';
import { publishWorkshopCheckInPdfArchiveIfUnset } from './workshop-check-in-pdf-archive.js';

describe('publishWorkshopCheckInPdfArchiveIfUnset', () => {
  it('writes the PDF digest only while pdf_sha256 is still null', async () => {
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const tx = { workshopCheckIn: { updateMany } };

    const input = {
      tenantId: 'tenant-1',
      checkInId: 'check-in-1',
      storageBucket: 'evidence',
      storageKey: 'check-ins/check-in-1.pdf',
      pdfSha256: 'a'.repeat(64),
      generatedAt: new Date('2026-10-17T12:05:00.000Z'),
    };

    await expect(
      publishWorkshopCheckInPdfArchiveIfUnset(tx as never, input),
    ).resolves.toBe(true);
    await expect(
      publishWorkshopCheckInPdfArchiveIfUnset(tx as never, input),
    ).resolves.toBe(false);

    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        tenant_id: input.tenantId,
        id: input.checkInId,
        status: WorkshopCheckInStatus.COMPLETED,
        pdf_sha256: null,
      },
      data: {
        pdf_storage_bucket: input.storageBucket,
        pdf_storage_key: input.storageKey,
        pdf_sha256: input.pdfSha256,
        pdf_generated_at: input.generatedAt,
      },
    });
  });
});
