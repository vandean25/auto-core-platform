import { resolveInvoiceMarginSchemeLegalNote } from './invoice-margin-scheme-legal-note.helpers.js';
import { isInvoiceSnapshotV2 } from './invoice-snapshot-v2.validation.js';

type InvoiceResponseWithPrivateFields = {
  snapshot: unknown;
  draft_number_seq?: unknown;
  date_day?: unknown;
  tax_mode?: import('@prisma/client').InvoiceTaxMode | null;
  legal_entity?: { country_iso: string } | null;
  pdf_archive_bucket?: unknown;
  pdf_archive_key?: unknown;
  pdf_archive_generation?: unknown;
  pdf_archive_sha256?: unknown;
  pdf_storage_bucket?: unknown;
  pdf_storage_key?: unknown;
};

type PrivateInvoiceResponseField =
  | 'snapshot'
  | 'draft_number_seq'
  | 'date_day'
  | 'legal_entity'
  | 'pdf_archive_bucket'
  | 'pdf_archive_key'
  | 'pdf_archive_generation'
  | 'pdf_archive_sha256'
  | 'pdf_storage_bucket'
  | 'pdf_storage_key';

export function omitInvoiceSnapshot<T extends InvoiceResponseWithPrivateFields>(
  invoice: T,
): Omit<T, PrivateInvoiceResponseField> & {
  margin_scheme_legal_note?: string | null;
  rounding_amount?: string;
} {
  const {
    snapshot: _snapshot,
    draft_number_seq: _draftNumberSeq,
    date_day: _dateDay,
    legal_entity: _legalEntity,
    pdf_archive_bucket: _pdfArchiveBucket,
    pdf_archive_key: _pdfArchiveKey,
    pdf_archive_generation: _pdfArchiveGeneration,
    pdf_archive_sha256: _pdfArchiveSha256,
    pdf_storage_bucket: _pdfStorageBucket,
    pdf_storage_key: _pdfStorageKey,
    ...response
  } = invoice;
  void [
    _snapshot,
    _draftNumberSeq,
    _dateDay,
    _legalEntity,
    _pdfArchiveBucket,
    _pdfArchiveKey,
    _pdfArchiveGeneration,
    _pdfArchiveSha256,
    _pdfStorageBucket,
    _pdfStorageKey,
  ];

  const marginSchemeLegalNote = resolveInvoiceMarginSchemeLegalNote({
    tax_mode: response.tax_mode,
    snapshot: _snapshot,
  });

  const rounding = isInvoiceSnapshotV2(_snapshot)
    ? _snapshot.rounding_amount
    : undefined;
  return {
    ...response,
    ...(marginSchemeLegalNote
      ? { margin_scheme_legal_note: marginSchemeLegalNote }
      : {}),
    ...(typeof rounding === 'string' ? { rounding_amount: rounding } : {}),
  };
}
