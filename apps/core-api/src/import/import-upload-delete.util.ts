import { readUploadRef } from './import-job.worker-state.js';
import type { ImportJobOptionsWithWorker } from './import-job.worker-state.js';
import type { ImportFileStorageService } from './import-file.storage.js';

/** Deletes the stored CSV of a job when one is recorded in its options. */
export async function deleteImportJobUpload(
  fileStorage: ImportFileStorageService,
  options: ImportJobOptionsWithWorker,
): Promise<void> {
  const upload = readUploadRef(options);
  if (!upload) {
    return;
  }
  await fileStorage.deleteUpload(upload).catch(() => undefined);
}
