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

export async function publishWorkshopCheckInEvidencePdfArchive(params: {
  storage: Pick<
    PdfStorage,
    'publishImmutableObject' | 'readImmutableObjectByKey'
  >;
  prisma: Prisma.TransactionClient;
  tenantId: string;
  checkInId: string;
  workshopOrderId: string;
  contentSha256: string;
  pdfBytes: Buffer;
  generatedAt: Date;
  bucket: string;
}): Promise<string | null> {
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

  let archiveSha256: string;
  try {
    const archive = await params.storage.publishImmutableObject({
      key,
      body: params.pdfBytes,
      contentType: 'application/pdf',
      customMetadata: identity,
    });
    archiveSha256 = archive.sha256;
  } catch (error) {
    if (getErrorCode(error) !== 412) {
      throw error;
    }
    const existing = await params.storage.readImmutableObjectByKey({
      bucket: params.bucket,
      key,
      validateMetadata: (metadata) => metadataMatches(metadata, identity),
    });
    archiveSha256 = existing.sha256;
  }

  const published = await publishWorkshopCheckInPdfArchiveIfUnset(
    params.prisma,
    {
      tenantId: params.tenantId,
      checkInId: params.checkInId,
      storageBucket: params.bucket,
      storageKey: key,
      pdfSha256: archiveSha256,
      generatedAt: params.generatedAt,
    },
  );

  return published ? archiveSha256 : null;
}
