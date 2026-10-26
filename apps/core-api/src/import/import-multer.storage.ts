import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { diskStorage } from 'multer';
import { IMPORT_MAX_FILE_BYTES } from './import.constants.js';
import { IMPORT_MULTER_STAGING_DIR } from './import-file.storage.js';

mkdirSync(IMPORT_MULTER_STAGING_DIR, { recursive: true });

export const importUploadMulterOptions = {
  storage: diskStorage({
    destination: IMPORT_MULTER_STAGING_DIR,
    filename: (_req, _file, callback) => {
      callback(null, `${randomUUID()}.csv`);
    },
  }),
  limits: {
    fileSize: IMPORT_MAX_FILE_BYTES + 5 * 1024 * 1024,
  },
};
