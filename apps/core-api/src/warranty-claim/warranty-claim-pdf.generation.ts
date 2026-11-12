export type WarrantyClaimPdfCacheFields = {
  pdf_storage_bucket: string | null;
  pdf_storage_key: string | null;
  pdf_generated_at: Date | null;
  pdf_generation_error?: string | null;
};

export type CachedWarrantyClaimPdfMetadata = {
  bucket: string;
  key: string;
  generatedAt: Date;
};

export const warrantyClaimPdfObjectKey = (claimId: string): string =>
  `warranty-claims/${claimId}.pdf`;

export const readCachedWarrantyClaimPdfMetadata = (
  claim: WarrantyClaimPdfCacheFields,
): CachedWarrantyClaimPdfMetadata | null => {
  if (
    !claim.pdf_storage_key ||
    !claim.pdf_storage_bucket ||
    !claim.pdf_generated_at ||
    claim.pdf_generation_error
  ) {
    return null;
  }

  return {
    bucket: claim.pdf_storage_bucket,
    key: claim.pdf_storage_key,
    generatedAt: claim.pdf_generated_at,
  };
};

export const clearWarrantyClaimPdfArchiveData = () =>
  ({
    pdf_storage_bucket: null,
    pdf_storage_key: null,
    pdf_generated_at: null,
    pdf_generation_error: null,
  }) as const;

/** Same grace window as workshop order PDFs (metadata writes bump `updatedAt`). */
export const WARRANTY_CLAIM_PDF_ARCHIVE_GRACE_MS = 2000;

export type WarrantyClaimPdfHeaderTimestamps = {
  claimUpdatedAt: Date;
  orderUpdatedAt: Date;
  vehicleUpdatedAt: Date;
  legalEntityUpdatedAt: Date;
};

export const latestWarrantyClaimPdfSourceChange = (
  sources: WarrantyClaimPdfHeaderTimestamps,
): Date =>
  new Date(
    Math.max(
      sources.claimUpdatedAt.getTime(),
      sources.orderUpdatedAt.getTime(),
      sources.vehicleUpdatedAt.getTime(),
      sources.legalEntityUpdatedAt.getTime(),
    ),
  );

export const isWarrantyClaimPdfArchiveStale = (
  params: {
    pdfGeneratedAt: Date | null;
  } & WarrantyClaimPdfHeaderTimestamps,
): boolean => {
  if (!params.pdfGeneratedAt) {
    return true;
  }
  const latestChange = latestWarrantyClaimPdfSourceChange(params);
  return (
    params.pdfGeneratedAt.getTime() <=
    latestChange.getTime() - WARRANTY_CLAIM_PDF_ARCHIVE_GRACE_MS
  );
};
