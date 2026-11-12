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
