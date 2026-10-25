import { BadRequestException } from '@nestjs/common';
import {
  buildGcsImportObjectKey,
  buildTenantImportObjectKey,
  LocalImportFileStorage,
  assertTrustedImportStagingPath,
  sanitizeImportFileName,
} from './import-file.storage.js';

describe('import file storage path safety', () => {
  it('strips directory components from upload file names', () => {
    expect(sanitizeImportFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeImportFileName('..\\evil.csv')).toBe('evil.csv');
    expect(sanitizeImportFileName('')).toBe('import.csv');
  });

  it('builds tenant object keys with safe segments only', () => {
    expect(
      buildTenantImportObjectKey({
        tenantId: 'tenant-1',
        jobId: 'job-2',
        fileName: '../prices.csv',
      }),
    ).toBe('tenant-1/job-2/prices.csv');
  });

  it('rejects staging paths outside the temp directory', () => {
    expect(() => assertTrustedImportStagingPath('/etc/passwd')).toThrow(
      BadRequestException,
    );
  });

  it('rejects path traversal in stored object keys for local reads', async () => {
    const storage = new LocalImportFileStorage();
    await expect(
      storage.readBytes({ object_key: '../../outside.csv' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores and reads under the configured root', async () => {
    const storage = new LocalImportFileStorage();
    const ref = await storage.storeUpload({
      tenantId: 'tenant-a',
      jobId: 'job-b',
      fileName: 'data.csv',
      content: Buffer.from('a,b\n1,2\n', 'utf8'),
    });

    expect(ref.object_key).toBe('tenant-a/job-b/data.csv');
    expect(buildGcsImportObjectKey({
      tenantId: 'tenant-a',
      jobId: 'job-b',
      fileName: 'data.csv',
    })).toBe('tenants/tenant-a/imports/job-b/data.csv');

    const bytes = await storage.readBytes(ref);
    expect(bytes.toString('utf8')).toContain('a,b');

    await storage.deleteUpload(ref);
  });
});
