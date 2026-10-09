import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PdfStorage } from './pdf-storage.js';

const PDF_BYTES = Buffer.from('abc');
const PDF_SHA256 =
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const CUSTOM_METADATA = {
  tenant_id: 'tenant-1',
  invoice_id: 'invoice-1',
  snapshot_sha256: 'a'.repeat(64),
  template_version: 'invoice-brand-v1',
  pdf_sha256: PDF_SHA256,
};

describe('PdfStorage immutable PDF archive', () => {
  const originalBucket = process.env.INVOICE_PDF_BUCKET;
  let service: PdfStorage;
  let file: {
    save: jest.Mock;
    getMetadata: jest.Mock;
    download: jest.Mock;
  };
  let fileForKey: jest.Mock;

  beforeEach(() => {
    process.env.INVOICE_PDF_BUCKET = 'invoice-pdf-test';
    file = {
      save: jest.fn().mockResolvedValue(undefined),
      getMetadata: jest.fn().mockResolvedValue([
        {
          generation: '42',
          contentType: 'application/pdf',
          metadata: CUSTOM_METADATA,
        },
      ]),
      download: jest.fn().mockResolvedValue([PDF_BYTES]),
    };
    fileForKey = jest.fn().mockReturnValue(file);
    service = new PdfStorage();
    Object.defineProperty(service, 'storage', {
      value: {
        bucket: jest.fn().mockReturnValue({ file: fileForKey }),
      },
    });
  });

  afterEach(() => {
    if (originalBucket === undefined) {
      delete process.env.INVOICE_PDF_BUCKET;
    } else {
      process.env.INVOICE_PDF_BUCKET = originalBucket;
    }
  });

  it('creates an archive once with verified identity metadata and returns its exact generation', async () => {
    const result = await service.publishImmutablePdf({
      key: 'tenant-1/invoice-1/snapshot/invoice-brand-v1.pdf',
      body: PDF_BYTES,
      contentType: 'application/pdf',
      customMetadata: {
        tenant_id: 'tenant-1',
        invoice_id: 'invoice-1',
        snapshot_sha256: 'a'.repeat(64),
        template_version: 'invoice-brand-v1',
      },
    });

    expect(file.save).toHaveBeenCalledWith(
      PDF_BYTES,
      expect.objectContaining({
        contentType: 'application/pdf',
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          cacheControl: 'private, no-store',
          metadata: CUSTOM_METADATA,
        },
      }),
    );
    expect(result).toEqual({
      bucket: 'invoice-pdf-test',
      key: 'tenant-1/invoice-1/snapshot/invoice-brand-v1.pdf',
      generation: '42',
      sha256: PDF_SHA256,
      customMetadata: CUSTOM_METADATA,
    });
  });

  it('never overwrites a pre-existing archive when create-only publication loses', async () => {
    const conflict = Object.assign(
      new Error('generation precondition failed'),
      {
        code: 412,
      },
    );
    file.save.mockRejectedValue(conflict);

    await expect(
      service.publishImmutablePdf({
        key: 'tenant-1/invoice-1/snapshot/invoice-brand-v1.pdf',
        body: PDF_BYTES,
        contentType: 'application/pdf',
        customMetadata: {
          tenant_id: 'tenant-1',
          invoice_id: 'invoice-1',
          snapshot_sha256: 'a'.repeat(64),
          template_version: 'invoice-brand-v1',
        },
      }),
    ).rejects.toMatchObject({ code: 412 });

    expect(file.save).toHaveBeenCalledTimes(1);
    expect(file.getMetadata).not.toHaveBeenCalled();
  });

  it('reads and rehashes the requested exact PDF generation', async () => {
    const result = await service.readImmutablePdfGeneration({
      bucket: 'invoice-pdf-test',
      key: 'tenant-1/invoice-1/archive.pdf',
      generation: '42',
      expectedSha256: PDF_SHA256,
    });

    expect(fileForKey).toHaveBeenCalledWith('tenant-1/invoice-1/archive.pdf', {
      generation: '42',
    });
    expect(file.download).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      bucket: 'invoice-pdf-test',
      key: 'tenant-1/invoice-1/archive.pdf',
      generation: '42',
      sha256: PDF_SHA256,
      customMetadata: CUSTOM_METADATA,
      body: PDF_BYTES,
    });
    expect(createHash('sha256').update(result.body).digest('hex')).toBe(
      PDF_SHA256,
    );
  });

  it('discovers and verifies a create-only archive winner by expected identity', async () => {
    await expect(
      service.readImmutablePdfByKey({
        bucket: 'invoice-pdf-test',
        key: 'tenant-1/invoice-1/archive.pdf',
        expectedIdentity: {
          tenant_id: 'tenant-1',
          invoice_id: 'invoice-1',
          snapshot_sha256: 'a'.repeat(64),
          template_version: 'invoice-brand-v1',
        },
      }),
    ).resolves.toMatchObject({
      generation: '42',
      sha256: PDF_SHA256,
      body: PDF_BYTES,
    });
  });

  it('rejects a create-only archive winner with different identity metadata', async () => {
    file.getMetadata.mockResolvedValue([
      {
        generation: '42',
        metadata: { ...CUSTOM_METADATA, invoice_id: 'other-invoice' },
      },
    ]);

    await expect(
      service.readImmutablePdfByKey({
        bucket: 'invoice-pdf-test',
        key: 'tenant-1/invoice-1/archive.pdf',
        expectedIdentity: {
          tenant_id: 'tenant-1',
          invoice_id: 'invoice-1',
          snapshot_sha256: 'a'.repeat(64),
          template_version: 'invoice-brand-v1',
        },
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it.each([
    ['tenant_id', 'other-tenant'],
    ['invoice_id', 'other-invoice'],
    ['snapshot_sha256', 'b'.repeat(64)],
  ] as const)(
    'rejects a create-only archive winner with a different %s',
    async (field, value) => {
      file.getMetadata.mockResolvedValue([
        {
          generation: '42',
          metadata: { ...CUSTOM_METADATA, [field]: value },
        },
      ]);

      await expect(
        service.readImmutablePdfByKey({
          bucket: 'invoice-pdf-test',
          key: 'tenant-1/invoice-1/archive.pdf',
          expectedIdentity: {
            tenant_id: 'tenant-1',
            invoice_id: 'invoice-1',
            snapshot_sha256: 'a'.repeat(64),
            template_version: 'invoice-brand-v1',
          },
        }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);

      expect(file.download).not.toHaveBeenCalled();
    },
  );

  it('rejects a create-only archive winner when its PDF bytes do not match the hash', async () => {
    file.download.mockResolvedValue([Buffer.from('corrupted pdf bytes')]);

    await expect(
      service.readImmutablePdfByKey({
        bucket: 'invoice-pdf-test',
        key: 'tenant-1/invoice-1/archive.pdf',
        expectedIdentity: {
          tenant_id: 'tenant-1',
          invoice_id: 'invoice-1',
          snapshot_sha256: 'a'.repeat(64),
          template_version: 'invoice-brand-v1',
        },
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('reports an unavailable error for a missing exact PDF generation', async () => {
    file.getMetadata.mockRejectedValue({ code: 404 });

    await expect(
      service.readImmutablePdfGeneration({
        bucket: 'invoice-pdf-test',
        key: 'tenant-1/invoice-1/archive.pdf',
        generation: '404',
        expectedSha256: PDF_SHA256,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reports corrupt bytes as an unavailable immutable PDF generation', async () => {
    file.download.mockResolvedValue([Buffer.from('changed')]);

    await expect(
      service.readImmutablePdfGeneration({
        bucket: 'invoice-pdf-test',
        key: 'tenant-1/invoice-1/archive.pdf',
        generation: '42',
        expectedSha256: PDF_SHA256,
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});

describe('PdfStorage generic immutable objects', () => {
  const SALE_IDENTITY = {
    tenant_id: 'tenant-1',
    vehicle_sale_id: 'sale-1',
    snapshot_sha256: 'c'.repeat(64),
    template_version: 'kaufvertrag-brand-v1',
  };
  const OTHER_SALE_IDENTITY = { ...SALE_IDENTITY, vehicle_sale_id: 'sale-2' };
  let service: PdfStorage;
  let file: { getMetadata: jest.Mock; download: jest.Mock; save: jest.Mock };

  beforeEach(() => {
    process.env.INVOICE_PDF_BUCKET = 'invoice-pdf-test';
    file = {
      save: jest.fn().mockResolvedValue(undefined),
      getMetadata: jest.fn().mockResolvedValue([
        {
          generation: '77',
          contentType: 'application/pdf',
          metadata: { ...SALE_IDENTITY, pdf_sha256: PDF_SHA256 },
        },
      ]),
      download: jest.fn().mockResolvedValue([PDF_BYTES]),
    };
    service = new PdfStorage();
    Object.defineProperty(service, 'storage', {
      value: {
        bucket: jest.fn().mockReturnValue({
          file: jest.fn().mockReturnValue(file),
        }),
      },
    });
  });

  it('publishes a create-only object with arbitrary identity metadata', async () => {
    const result = await service.publishImmutableObject({
      key: 'vehicle-sale-kaufvertrag-archives/tenant-1/sale-1/x.pdf',
      body: PDF_BYTES,
      contentType: 'application/pdf',
      customMetadata: SALE_IDENTITY,
    });

    expect(file.save).toHaveBeenCalledWith(
      PDF_BYTES,
      expect.objectContaining({
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: expect.objectContaining({
          metadata: { ...SALE_IDENTITY, pdf_sha256: PDF_SHA256 },
        }),
      }),
    );
    expect(result).toMatchObject({ generation: '77', sha256: PDF_SHA256 });
  });

  it('adopts an existing object by key only when its identity validates', async () => {
    const archive = await service.readImmutableObjectByKey({
      bucket: 'invoice-pdf-test',
      key: 'vehicle-sale-kaufvertrag-archives/tenant-1/sale-1/x.pdf',
      validateMetadata: (metadata) =>
        metadata.vehicle_sale_id === SALE_IDENTITY.vehicle_sale_id &&
        metadata.tenant_id === SALE_IDENTITY.tenant_id,
    });

    expect(archive.generation).toBe('77');
    expect(archive.body).toEqual(PDF_BYTES);
  });

  it('refuses an existing object whose identity does not validate', async () => {
    await expect(
      service.readImmutableObjectByKey({
        bucket: 'invoice-pdf-test',
        key: 'vehicle-sale-kaufvertrag-archives/tenant-1/sale-2/x.pdf',
        validateMetadata: (metadata) =>
          metadata.vehicle_sale_id === OTHER_SALE_IDENTITY.vehicle_sale_id,
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('refuses an exact generation whose metadata fails the validator even when the bytes match', async () => {
    await expect(
      service.readImmutableObjectGeneration({
        bucket: 'invoice-pdf-test',
        key: 'vehicle-sale-kaufvertrag-archives/tenant-1/sale-1/x.pdf',
        generation: '77',
        expectedSha256: PDF_SHA256,
        validateMetadata: () => false,
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
