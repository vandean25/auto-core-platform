type InvoiceResponseWithPrivateFields = {
  snapshot: unknown;
  pdf_archive_bucket?: unknown;
  pdf_archive_key?: unknown;
  pdf_archive_generation?: unknown;
  pdf_archive_sha256?: unknown;
  pdf_storage_bucket?: unknown;
  pdf_storage_key?: unknown;
};

type PrivateInvoiceResponseField =
  | 'snapshot'
  | 'pdf_archive_bucket'
  | 'pdf_archive_key'
  | 'pdf_archive_generation'
  | 'pdf_archive_sha256'
  | 'pdf_storage_bucket'
  | 'pdf_storage_key';

export function omitInvoiceSnapshot<T extends InvoiceResponseWithPrivateFields>(
  invoice: T,
): Omit<T, PrivateInvoiceResponseField> {
  const {
    snapshot: _snapshot,
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
    _pdfArchiveBucket,
    _pdfArchiveKey,
    _pdfArchiveGeneration,
    _pdfArchiveSha256,
    _pdfStorageBucket,
    _pdfStorageKey,
  ];
  return response;
}
