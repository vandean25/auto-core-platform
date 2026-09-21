import { BadRequestException } from '@nestjs/common';
import { CreditNoteStatus } from '@prisma/client';

export type CachedPdfMetadata = {
  bucket: string;
  key: string;
  generatedAt: Date;
};

type CreditNotePdfCacheFields = {
  pdf_storage_bucket: string | null;
  pdf_storage_key: string | null;
  pdf_generated_at: Date | null;
};

export const readCachedCreditNotePdfMetadata = (
  creditNote: CreditNotePdfCacheFields,
): CachedPdfMetadata | null => {
  if (
    !creditNote.pdf_storage_key ||
    !creditNote.pdf_storage_bucket ||
    !creditNote.pdf_generated_at
  ) {
    return null;
  }

  return {
    bucket: creditNote.pdf_storage_bucket,
    key: creditNote.pdf_storage_key,
    generatedAt: creditNote.pdf_generated_at,
  };
};

export const assertCreditNotePdfGenerationAllowed = (
  status: CreditNoteStatus,
) => {
  if (status !== CreditNoteStatus.FINALIZED) {
    throw new BadRequestException(
      'Credit note PDF can only be generated for FINALIZED credit notes.',
    );
  }
};
