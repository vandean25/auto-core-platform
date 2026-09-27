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

export type CreditNotePdfStorageCandidate = {
  bucket?: string;
  key: string;
};

export const creditNotePdfObjectKey = (creditNoteId: string): string =>
  `credit-notes/${creditNoteId}.pdf`;

export const isCreditNotePdfGenerationComplete = (
  creditNote: CreditNotePdfCacheFields & {
    pdf_generation_error?: string | null;
  },
): boolean =>
  Boolean(creditNote.pdf_generated_at) && !creditNote.pdf_generation_error;

export const buildCreditNotePdfStorageCandidates = (
  creditNote: CreditNotePdfCacheFields,
  creditNoteId: string,
): CreditNotePdfStorageCandidate[] => {
  const candidates: CreditNotePdfStorageCandidate[] = [];
  const seen = new Set<string>();

  const add = (candidate: CreditNotePdfStorageCandidate) => {
    if (!candidate.key || seen.has(candidate.key)) {
      return;
    }
    seen.add(candidate.key);
    candidates.push(candidate);
  };

  const cached = readCachedCreditNotePdfMetadata(creditNote);
  if (cached) {
    add({ bucket: cached.bucket, key: cached.key });
  }

  if (creditNote.pdf_storage_key) {
    add({
      bucket: creditNote.pdf_storage_bucket ?? undefined,
      key: creditNote.pdf_storage_key,
    });
  }

  add({ key: creditNotePdfObjectKey(creditNoteId) });

  return candidates;
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
