import { readStoredCheckInContentSha256 } from './workshop-order-pdf-render-input.js';

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
  pdf_render_input?: unknown;
};

export type WorkshopPdfCacheContext = {
  checkInContentSha256: string | null;
  checkInCompletedAt: Date | null;
};

export const readCachedWorkshopPdfMetadata = (
  order: WorkshopPdfCacheFields,
  context: WorkshopPdfCacheContext = {
    checkInContentSha256: null,
    checkInCompletedAt: null,
  },
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

  if (
    context.checkInCompletedAt &&
    order.pdf_generated_at < context.checkInCompletedAt
  ) {
    return null;
  }

  const storedCheckInSha = readStoredCheckInContentSha256(
    order.pdf_render_input,
  );
  if (storedCheckInSha !== context.checkInContentSha256) {
    return null;
  }

  return {
    bucket: order.pdf_storage_bucket,
    key: order.pdf_storage_key,
    generatedAt: order.pdf_generated_at,
  };
};
