import { join, resolve } from 'node:path';
import {
  buildImportMulterStagingPath,
  setImportStagingKey,
} from './import-staging-path.js';
import { IMPORT_MULTER_STAGING_DIR } from './import-file.storage.js';

describe('buildImportMulterStagingPath', () => {
  it('resolves only server-recorded staging keys under the staging root', () => {
    const request = {};
    const key = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890.csv';
    setImportStagingKey(request, key);
    const path = buildImportMulterStagingPath(request);
    expect(path).toBe(resolve(join(IMPORT_MULTER_STAGING_DIR, key)));
  });
});
