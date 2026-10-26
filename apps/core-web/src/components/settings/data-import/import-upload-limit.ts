export const IMPORT_UPLOAD_MAX_BYTES = 30 * 1024 * 1024

export const IMPORT_UPLOAD_TOO_LARGE_MESSAGE =
  'Datei zu groß (max. 30 MB), bitte aufteilen'

export function assertImportUploadFileSize(file: File): void {
  if (file.size > IMPORT_UPLOAD_MAX_BYTES) {
    throw new Error(IMPORT_UPLOAD_TOO_LARGE_MESSAGE)
  }
}
