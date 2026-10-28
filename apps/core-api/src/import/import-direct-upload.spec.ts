import { NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { ImportFileStorageService } from './import-file.storage.js';
import {
  assertDirectUploadStagingKeyForTenant,
  buildDirectUploadStagingObjectKey,
} from './import-direct-upload.js';
import { ImportDirectUploadService } from './import-direct-upload.service.js';
import {
  DirectUploadSourceChangedError,
  GcsDirectImportUploadStorage,
  IMPORT_DIRECT_UPLOAD_LOCAL_ROOT,
  LocalDirectImportUploadStorage,
  type DirectImportUploadStorage,
  writeLocalDirectUploadStagingObject,
} from './import-direct-upload.storage.js';
import type { ImportService } from './import.service.js';

const TENANT_ID = 'tenant-a';
const MAX_BYTES = 1024;
const BUCKET = 'import-upload-test-bucket';
const originalBucket = process.env.IMPORT_UPLOAD_BUCKET;
const originalMax = process.env.IMPORT_DIRECT_UPLOAD_MAX_FILE_BYTES;

beforeAll(() => {
  process.env.IMPORT_UPLOAD_BUCKET = BUCKET;
  process.env.IMPORT_DIRECT_UPLOAD_MAX_FILE_BYTES = String(MAX_BYTES);
});

afterAll(() => {
  if (originalBucket === undefined) delete process.env.IMPORT_UPLOAD_BUCKET;
  else process.env.IMPORT_UPLOAD_BUCKET = originalBucket;
  if (originalMax === undefined) {
    delete process.env.IMPORT_DIRECT_UPLOAD_MAX_FILE_BYTES;
  } else {
    process.env.IMPORT_DIRECT_UPLOAD_MAX_FILE_BYTES = originalMax;
  }
});

class StorageUnderTest extends GcsDirectImportUploadStorage {
  constructor(storage: unknown) {
    super();
    this.storage = storage as GcsDirectImportUploadStorage['storage'];
  }
}

function tenantContext(tenantId = TENANT_ID): TenantContextService {
  return {
    getAuthenticatedUser: () => ({ role: 'ADMIN' }),
    getTenantId: async () => tenantId,
  } as unknown as TenantContextService;
}

type StorageStub = {
  signResumableUpload: jest.Mock;
  statStagingObject: jest.Mock;
  copyStagingToJobObject: jest.Mock;
  deleteStagingObject: jest.Mock;
};

function storageStub(
  overrides: Partial<DirectImportUploadStorage> = {},
): StorageStub {
  const stub: StorageStub = {
    signResumableUpload: jest.fn(async () => ({
      signedUrl: 'https://storage.googleapis.com/signed',
    })),
    statStagingObject: jest.fn(async () => null),
    copyStagingToJobObject: jest.fn(async () => undefined),
    deleteStagingObject: jest.fn(async () => undefined),
  };
  return Object.assign(stub, overrides);
}

function serviceWith(params: {
  storage: DirectImportUploadStorage;
  fileStorage?: Record<string, unknown>;
  importService?: Record<string, unknown>;
  tenantId?: string;
}): ImportDirectUploadService {
  return new ImportDirectUploadService(
    tenantContext(params.tenantId),
    params.storage as never,
    (params.fileStorage ?? {}) as unknown as ImportFileStorageService,
    (params.importService ?? {}) as unknown as ImportService,
  );
}

describe('GcsDirectImportUploadStorage signing', () => {
  it('signs a V4 resumable URL with a fixed content type', async () => {
    const getSignedUrl = jest.fn(async () => [
      'https://storage.googleapis.com/signed',
    ]);
    const file = jest.fn(() => ({ getSignedUrl }));
    const bucket = jest.fn(() => ({ file }));
    const storage = new StorageUnderTest({ bucket });
    const expiresAt = new Date('2026-10-28T12:15:00.000Z');

    await expect(
      storage.signResumableUpload({
        objectKey: 'import-uploads/tenants/tenant-a/upload-id/report.csv',
        contentType: 'text/csv',
        maxBytes: 4096,
        expiresAt,
      }),
    ).resolves.toEqual({ signedUrl: 'https://storage.googleapis.com/signed' });

    expect(bucket).toHaveBeenCalledWith(BUCKET);
    expect(file).toHaveBeenCalledWith(
      'import-uploads/tenants/tenant-a/upload-id/report.csv',
    );
    expect(getSignedUrl).toHaveBeenCalledWith({
      version: 'v4',
      action: 'resumable',
      expires: expiresAt,
      contentType: 'text/csv',
      virtualHostedStyle: false,
    });
  });
});

describe('GcsDirectImportUploadStorage copy', () => {
  const sourceKey = `import-uploads/tenants/${TENANT_ID}/upload-id/report.csv`;
  const destinationKey = `tenants/${TENANT_ID}/imports/job-1/report.csv`;
  const sourceGeneration = '1712345678901234';

  function storageWithCopy(copy: jest.Mock) {
    const source = { copy };
    const destination = { name: destinationKey };
    const file = jest.fn((name: string) =>
      name === destinationKey ? destination : source,
    );
    const bucket = jest.fn(() => ({ file }));
    return { storage: new StorageUnderTest({ bucket }), file, source };
  }

  it('copies the exact generation that was validated', async () => {
    const copy = jest.fn(async () => undefined);
    const { storage, file, source } = storageWithCopy(copy);

    await storage.copyStagingToJobObject({
      sourceKey,
      destinationKey,
      sourceGeneration,
    });

    expect(file).toHaveBeenCalledWith(sourceKey, {
      generation: sourceGeneration,
    });
    expect(source.copy).toHaveBeenCalledWith(
      { name: destinationKey },
      expect.objectContaining({
        preconditionOpts: { ifGenerationMatch: 0 },
      }),
    );
  });

  it('treats a failed source precondition as a changed upload', async () => {
    const copy = jest.fn(async () => {
      throw Object.assign(new Error('precondition failed'), { code: 412 });
    });
    const { storage } = storageWithCopy(copy);

    await expect(
      storage.copyStagingToJobObject({
        sourceKey,
        destinationKey,
        sourceGeneration,
      }),
    ).rejects.toBeInstanceOf(DirectUploadSourceChangedError);
  });
});

describe('ImportDirectUploadService.start', () => {
  it('issues a tenant-scoped staging key, 15 minute expiry and size cap', async () => {
    const storage = storageStub();
    const service = serviceWith({ storage });
    const before = Date.now();

    const started = await service.start({
      fileName: '..\\..\\quarterly report.csv',
      size: 100,
      contentType: 'TEXT/CSV; charset=utf-8',
    });

    expect(started.upload_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(started.upload_url).toBe(
      'https://storage.googleapis.com/signed',
    );
    expect(started.method).toBe('POST');
    expect(started.content_type).toBe('text/csv');
    expect(started.max_bytes).toBe(100);
    expect(started.headers).toEqual({
      'x-goog-resumable': 'start',
      'Content-Type': 'text/csv',
    });
    expect(storage.signResumableUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        objectKey: `import-uploads/tenants/${TENANT_ID}/${started.upload_id}/quarterly report.csv`,
        contentType: 'text/csv',
        maxBytes: 100,
      }),
    );
    const expiresAt = new Date(started.expires_at).getTime();
    expect(expiresAt - before).toBeGreaterThanOrEqual(14 * 60 * 1000);
    expect(expiresAt - before).toBeLessThanOrEqual(16 * 60 * 1000);
  });

  it('rejects a file that is not a CSV', async () => {
    const service = serviceWith({ storage: storageStub() });

    await expect(
      service.start({ fileName: 'report.xlsx', size: 100 }),
    ).rejects.toMatchObject({
      response: { code: 'IMPORT_DIRECT_UPLOAD_INVALID' },
    });
  });

  it('rejects a declared size above the server cap', async () => {
    const service = serviceWith({ storage: storageStub() });

    await expect(
      service.start({ fileName: 'report.csv', size: MAX_BYTES + 1 }),
    ).rejects.toMatchObject({
      response: { code: 'IMPORT_DIRECT_UPLOAD_TOO_LARGE' },
    });
  });

  it('rejects an unsupported content type', async () => {
    const service = serviceWith({ storage: storageStub() });

    await expect(
      service.start({
        fileName: 'report.csv',
        size: 100,
        contentType: 'application/pdf',
      }),
    ).rejects.toMatchObject({
      response: { code: 'IMPORT_DIRECT_UPLOAD_CONTENT_TYPE' },
    });
  });
});

describe('ImportDirectUploadService.finalize', () => {
  const finalizeParams = (uploadId: string, size = 40) => ({
    uploadId,
    fileName: 'report.csv',
    size,
    entityType: 'CUSTOMER' as const,
    sourceSystem: 'legacy',
    mapping: { external_id: 'Kunden-Nr' },
  });

  it('only touches staging keys under the caller tenant', () => {
    const otherTenant = `import-uploads/tenants/tenant-b/${randomUUID()}/secret.csv`;
    expect(() =>
      assertDirectUploadStagingKeyForTenant(otherTenant, TENANT_ID),
    ).toThrow(NotFoundException);

    const traversal = `import-uploads/tenants/${TENANT_ID}/../tenant-b/${randomUUID()}/secret.csv`;
    expect(() =>
      assertDirectUploadStagingKeyForTenant(traversal, TENANT_ID),
    ).toThrow(NotFoundException);
  });

  it('rejects an upload whose staging object is missing', async () => {
    const storage = storageStub({ statStagingObject: jest.fn(async () => null) });
    const service = serviceWith({ storage });

    await expect(service.finalize(finalizeParams(randomUUID()))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects and deletes a staged object above the declared or server cap', async () => {
    const uploadId = randomUUID();
    const stagingKey = buildDirectUploadStagingObjectKey({
      tenantId: TENANT_ID,
      uploadId,
      fileName: 'report.csv',
    });
    const storage = storageStub({
      statStagingObject: jest.fn(async () => ({
        size: MAX_BYTES + 1,
        generation: 'gen-1',
      })),
    });
    const service = serviceWith({ storage });

    await expect(
      service.finalize(finalizeParams(uploadId, MAX_BYTES)),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(storage.copyStagingToJobObject).not.toHaveBeenCalled();
    expect(storage.deleteStagingObject).toHaveBeenCalledWith(stagingKey);
  });

  it('promotes the staged object and starts the existing background dry-run', async () => {
    const csv = Buffer.from(
      'Kunden-Nr;Vorname;Nachname\nK-1;Erika;Muster\n',
      'utf8',
    );
    const uploadId = randomUUID();
    const stagingKey = buildDirectUploadStagingObjectKey({
      tenantId: TENANT_ID,
      uploadId,
      fileName: 'report.csv',
    });
    const storage = storageStub({
      statStagingObject: jest.fn(async () => ({
        size: csv.byteLength,
        generation: 'gen-1',
      })),
    });
    const fileStorage = {
      openReadStream: jest.fn(() => Readable.from([csv])),
      deleteUpload: jest.fn(async () => undefined),
    };
    const createDryRunFromStoredUpload = jest.fn(async () => ({
      id: 'job-1',
    }));
    const service = serviceWith({
      storage,
      fileStorage,
      importService: { createDryRunFromStoredUpload },
    });

    const job = await service.finalize(finalizeParams(uploadId, 100));

    expect(job).toEqual({ id: 'job-1' });
    expect(storage.copyStagingToJobObject).toHaveBeenCalledWith({
      sourceKey: stagingKey,
      destinationKey: expect.stringMatching(
        new RegExp(
          `^tenants/${TENANT_ID}/imports/[0-9a-f-]{36}/report\\.csv$`,
        ),
      ),
      sourceGeneration: 'gen-1',
    });
    expect(storage.deleteStagingObject).toHaveBeenCalledWith(stagingKey);
    const destinationKey = storage.copyStagingToJobObject.mock
      .calls[0][0].destinationKey as string;
    const jobId = destinationKey.split('/')[3];
    expect(createDryRunFromStoredUpload).toHaveBeenCalledWith({
      jobId,
      ref: { object_key: destinationKey },
      fileName: 'report.csv',
      entityType: 'CUSTOMER',
      sourceSystem: 'legacy',
      mappingJson: { external_id: 'Kunden-Nr' },
      optionsJson: {},
      fileSha256: createHash('sha256').update(csv).digest('hex'),
      rowCount: 1,
    });
    expect(fileStorage.deleteUpload).not.toHaveBeenCalled();
  });

  it('rejects a staged object that changed before the copy and cleans up both objects', async () => {
    const uploadId = randomUUID();
    const stagingKey = buildDirectUploadStagingObjectKey({
      tenantId: TENANT_ID,
      uploadId,
      fileName: 'report.csv',
    });
    const storage = storageStub({
      statStagingObject: jest.fn(async () => ({
        size: 10,
        generation: 'gen-1',
      })),
      copyStagingToJobObject: jest.fn(async () => {
        throw new DirectUploadSourceChangedError();
      }),
    });
    const fileStorage = {
      openReadStream: jest.fn(),
      deleteUpload: jest.fn(async () => undefined),
    };
    const createDryRunFromStoredUpload = jest.fn();
    const service = serviceWith({
      storage,
      fileStorage,
      importService: { createDryRunFromStoredUpload },
    });

    await expect(
      service.finalize(finalizeParams(uploadId, 100)),
    ).rejects.toMatchObject({
      response: { code: 'IMPORT_DIRECT_UPLOAD_INVALID' },
    });
    expect(storage.copyStagingToJobObject).toHaveBeenCalledWith({
      sourceKey: stagingKey,
      destinationKey: expect.stringMatching(
        new RegExp(
          `^tenants/${TENANT_ID}/imports/[0-9a-f-]{36}/report\\.csv$`,
        ),
      ),
      sourceGeneration: 'gen-1',
    });
    expect(storage.deleteStagingObject).toHaveBeenCalledWith(stagingKey);
    expect(fileStorage.deleteUpload).toHaveBeenCalledWith({
      object_key: expect.stringMatching(
        new RegExp(`^tenants/${TENANT_ID}/imports/[0-9a-f-]{36}/report\\.csv$`),
      ),
    });
    expect(createDryRunFromStoredUpload).not.toHaveBeenCalled();
  });

  it('deletes the promoted object when the dry-run cannot be started', async () => {
    const csv = Buffer.from('Kunden-Nr\nK-1\n', 'utf8');
    const storage = storageStub({
      statStagingObject: jest.fn(async () => ({
        size: csv.byteLength,
        generation: 'gen-1',
      })),
    });
    const fileStorage = {
      openReadStream: jest.fn(() => Readable.from([csv])),
      deleteUpload: jest.fn(async () => undefined),
    };
    const service = serviceWith({
      storage,
      fileStorage,
      importService: {
        createDryRunFromStoredUpload: jest.fn(async () => {
          throw new Error('enqueue failed');
        }),
      },
    });

    await expect(
      service.finalize(finalizeParams(randomUUID(), 100)),
    ).rejects.toThrow('enqueue failed');
    expect(fileStorage.deleteUpload).toHaveBeenCalledWith({
      object_key: expect.stringMatching(
        new RegExp(`^tenants/${TENANT_ID}/imports/[0-9a-f-]{36}/report\\.csv$`),
      ),
    });
  });
});

describe('LocalDirectImportUploadStorage generation pinning', () => {
  const cleanupPaths: string[] = [];

  afterAll(async () => {
    await Promise.all(
      cleanupPaths.map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it('refuses to copy a staging object that changed after it was validated', async () => {
    const uploadId = randomUUID();
    cleanupPaths.push(
      join(
        IMPORT_DIRECT_UPLOAD_LOCAL_ROOT,
        'import-uploads',
        'tenants',
        TENANT_ID,
        uploadId,
      ),
    );
    const storage = new LocalDirectImportUploadStorage();
    const sourceKey = await writeLocalDirectUploadStagingObject({
      tenantId: TENANT_ID,
      uploadId,
      fileName: 'report.csv',
      content: Buffer.from('Kunden-Nr\nK-1\n', 'utf8'),
    });
    const staged = await storage.statStagingObject(sourceKey);
    if (!staged) {
      throw new Error('staging object was not written');
    }
    await writeLocalDirectUploadStagingObject({
      tenantId: TENANT_ID,
      uploadId,
      fileName: 'report.csv',
      content: Buffer.alloc(MAX_BYTES + 1, 'a'),
    });

    await expect(
      storage.copyStagingToJobObject({
        sourceKey,
        destinationKey: `tenants/${TENANT_ID}/imports/${randomUUID()}/report.csv`,
        sourceGeneration: staged.generation,
      }),
    ).rejects.toBeInstanceOf(DirectUploadSourceChangedError);
  });
});

describe('direct upload key validation', () => {
  it('sanitizes traversal in the file name', () => {
    const uploadId = randomUUID();
    expect(
      buildDirectUploadStagingObjectKey({
        tenantId: TENANT_ID,
        uploadId,
        fileName: '../../secrets.csv',
      }),
    ).toBe(
      `import-uploads/tenants/${TENANT_ID}/${uploadId}/secrets.csv`,
    );
  });
});
