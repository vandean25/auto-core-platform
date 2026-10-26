import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { diskStorage } from 'multer';
import { IMPORT_UPLOAD_MAX_FILE_BYTES } from './import.constants.js';
import { IMPORT_MULTER_STAGING_DIR } from './import-file.storage.js';
import { setImportStagingKey } from './import-staging-path.js';

mkdirSync(IMPORT_MULTER_STAGING_DIR, { recursive: true });

export const importUploadMulterOptions = {
  storage: diskStorage({
    destination: IMPORT_MULTER_STAGING_DIR,
    filename: (req, _file, callback) => {
      const key = `${randomUUID()}.csv`;
      setImportStagingKey(req, key);
      callback(null, key);
    },
  }),
  limits: {
    fileSize: IMPORT_UPLOAD_MAX_FILE_BYTES + 1024,
  },
};
