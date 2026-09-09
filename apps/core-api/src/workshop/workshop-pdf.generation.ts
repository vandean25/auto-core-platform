export type CachedPdfMetadata = {
  bucket: string;
  key: string;
  generatedAt: Date;
};

export type WorkshopPdfCacheFields = {
  pdf_storage_bucket: string | null;
  pdf_storage_key: string | null;
  pdf_generated_at: Date | null;
  updatedAt: Date;
};

export const readCachedWorkshopPdfMetadata = (
  order: WorkshopPdfCacheFields,
): CachedPdfMetadata | null => {
  if (
    !order.pdf_storage_key ||
    !order.pdf_storage_bucket ||
    !order.pdf_generated_at
  ) {
    return null;
  }

  const isCacheValid =
    order.pdf_generated_at > new Date(order.updatedAt.getTime() - 2000);

  if (!isCacheValid) {
    return null;
  }

  return {
    bucket: order.pdf_storage_bucket,
    key: order.pdf_storage_key,
    generatedAt: order.pdf_generated_at,
  };
};
