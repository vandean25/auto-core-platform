import type { Prisma } from '@prisma/client';
import type { PdfStorage } from '../common/pdf/pdf-storage.js';
import { getErrorCode } from '../invoices/invoice-pdf-archive.helpers.js';
import { publishWorkshopCheckInPdfArchiveIfUnset } from './workshop-check-in-pdf-archive.js';

export function buildWorkshopCheckInEvidencePdfKey(
  tenantId: string,
  checkInId: string,
  contentSha256: string,
): string {
  return `workshop-check-ins/${tenantId}/${checkInId}/${contentSha256}.pdf`;
}

export function buildWorkshopCheckInEvidencePdfIdentity(params: {
  tenantId: string;
  checkInId: string;
  workshopOrderId: string;
  contentSha256: string;
}): Record<string, string> {
  return {
    tenant_id: params.tenantId,
    workshop_check_in_id: params.checkInId,
    workshop_order_id: params.workshopOrderId,
    content_sha256: params.contentSha256,
    document_kind: 'WORKSHOP_CHECK_IN_EVIDENCE',
  };
}

function metadataMatches(
  actual: Record<string, string> | undefined,
  expected: Record<string, string>,
): boolean {
  return Object.entries(expected).every(
    ([key, value]) => actual?.[key] === value,
  );
}

/** GCS create-only upload; must run outside a DB transaction. */
export async function uploadWorkshopCheckInEvidencePdfArchiveObject(params: {
  storage: Pick<
    PdfStorage,
    'publishImmutableObject' | 'readImmutableObjectByKey'
  >;
  tenantId: string;
  checkInId: string;
  workshopOrderId: string;
  contentSha256: string;
  pdfBytes: Buffer;
  bucket: string;
}): Promise<{ key: string; sha256: string }> {
  const key = buildWorkshopCheckInEvidencePdfKey(
    params.tenantId,
    params.checkInId,
    params.contentSha256,
  );
  const identity = buildWorkshopCheckInEvidencePdfIdentity({
    tenantId: params.tenantId,
    checkInId: params.checkInId,
    workshopOrderId: params.workshopOrderId,
    contentSha256: params.contentSha256,
  });

  try {
    const archive = await params.storage.publishImmutableObject({
      key,
      body: params.pdfBytes,
      contentType: 'application/pdf',
      customMetadata: identity,
    });
    return { key, sha256: archive.sha256 };
  } catch (error) {
    if (getErrorCode(error) !== 412) {
      throw error;
    }
    const existing = await params.storage.readImmutableObjectByKey({
      bucket: params.bucket,
      key,
      validateMetadata: (metadata) => metadataMatches(metadata, identity),
    });
    return { key, sha256: existing.sha256 };
  }
}

/** Compare-and-set the check-in PDF pointer; fails when evidence is still unset. */
export async function persistWorkshopCheckInEvidencePdfArchiveRecord(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    checkInId: string;
    storageBucket: string;
    storageKey: string;
    pdfSha256: string;
    generatedAt: Date;
  },
): Promise<void> {
  const published = await publishWorkshopCheckInPdfArchiveIfUnset(tx, {
    tenantId: input.tenantId,
    checkInId: input.checkInId,
    storageBucket: input.storageBucket,
    storageKey: input.storageKey,
    pdfSha256: input.pdfSha256,
    generatedAt: input.generatedAt,
  });
  if (published) {
    return;
  }

  const current = await tx.workshopCheckIn.findFirst({
    where: { tenant_id: input.tenantId, id: input.checkInId },
    select: { pdf_sha256: true },
  });
  if (current?.pdf_sha256) {
    return;
  }

  throw new Error('Check-in evidence PDF could not be stored');
}
