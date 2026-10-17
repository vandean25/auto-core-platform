import type { Prisma } from '@prisma/client';
import { WorkshopCheckInStatus } from '@prisma/client';

export type PublishWorkshopCheckInPdfArchiveInput = {
  tenantId: string;
  checkInId: string;
  storageBucket: string;
  storageKey: string;
  pdfSha256: string;
  generatedAt: Date;
};

export async function publishWorkshopCheckInPdfArchiveIfUnset(
  tx: Prisma.TransactionClient,
  input: PublishWorkshopCheckInPdfArchiveInput,
): Promise<boolean> {
  const { count } = await tx.workshopCheckIn.updateMany({
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

  return count === 1;
}
