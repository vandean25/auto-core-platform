export const IMPORT_UPLOAD_MAX_BYTES = 30 * 1024 * 1024
export const IMPORT_DIRECT_UPLOAD_MAX_BYTES = 250 * 1024 * 1024

/** Files above the Cloud Run request cap go straight from the browser to GCS. */
export function usesDirectImportUpload(file: { size: number }): boolean {
  return file.size > IMPORT_UPLOAD_MAX_BYTES
}

export function assertImportUploadFileSize(
  file: { size: number },
  tooLargeMessage: string,
): void {
  if (file.size > IMPORT_DIRECT_UPLOAD_MAX_BYTES) {
    throw new Error(tooLargeMessage)
  }
}
