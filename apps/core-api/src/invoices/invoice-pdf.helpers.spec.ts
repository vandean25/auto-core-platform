import { createHash } from 'node:crypto';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  backfillInvoicePdfMetadata,
  brandRenderInputUnavailable,
  buildArchiveIdentity,
  buildArchiveKey,
  clearInvoiceGenerationError,
  dispatchInvoiceGeneration,
  formatRequestGenerationOutcome,
  getErrorCode,
  isBrandedSnapshot,
  loadFrozenLogo,
  persistBrandedArchiveMetadata,
  persistInvoiceGeneratedPdf,
  readArchiveFromMetadata,
  readArchiveMetadata,
  rethrowStorageNotFound,
  safeStoreInvoiceGenerationError,
  sameArchiveIdentity,
  toErrorMessage,
  toPdfStreamResult,
  uploadInvoicePdf,
  verifyFrozenAssetMetadata,
  verifyFrozenLogoHash,
  type AssetMetadata,
  type InvoiceBrandingLogo,
} from './invoice-pdf.helpers.js';
import { INVOICE_BRANDED_TEMPLATE_VERSION } from './invoice-snapshot-v2.js';
import { hashInvoiceSnapshot } from './invoice-snapshot-hash.js';
import type { PdfStorage } from '../common/pdf/pdf-storage.js';
import type { InvoicePdfRenderer } from './invoice-pdf.renderer.js';
import type { CloudTasksService } from '../common/index.js';


describe('invoice-pdf.helpers', () => {
  describe('brandRenderInputUnavailable', () => {
    it('creates an UnprocessableEntityException with default message and code', () => {
      const err = brandRenderInputUnavailable();
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect(err.getResponse()).toEqual({
        code: 'BRAND_RENDER_INPUT_UNAVAILABLE',
        message: 'Frozen branding or archive evidence is unavailable.',
      });
    });

    it('creates an UnprocessableEntityException with custom message', () => {
      const err = brandRenderInputUnavailable('Custom message');
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect(err.getResponse()).toEqual({
        code: 'BRAND_RENDER_INPUT_UNAVAILABLE',
        message: 'Custom message',
      });
    });
  });

  describe('isBrandedSnapshot', () => {
    it('returns true for object with INVOICE_BRANDED_TEMPLATE_VERSION', () => {
      expect(
        isBrandedSnapshot({
          template_version: INVOICE_BRANDED_TEMPLATE_VERSION,
        }),
      ).toBe(true);
    });

    it('returns false for non-objects or different template_version', () => {
      expect(isBrandedSnapshot(null)).toBe(false);
      expect(isBrandedSnapshot(undefined)).toBe(false);
      expect(isBrandedSnapshot('string')).toBe(false);
      expect(isBrandedSnapshot({})).toBe(false);
      expect(isBrandedSnapshot({ template_version: 'invoice-pdf-v1' })).toBe(
        false,
      );
    });
  });

  describe('readArchiveMetadata', () => {
    const validSha256 = 'a'.repeat(64);

    it('returns null when all archive fields are null or undefined', () => {
      expect(
        readArchiveMetadata({
          pdf_archive_bucket: null,
          pdf_archive_key: null,
          pdf_archive_generation: null,
          pdf_archive_sha256: null,
        }),
      ).toBeNull();
    });

    it('returns archive metadata when all fields are present and valid', () => {
      const result = readArchiveMetadata({
        pdf_archive_bucket: 'test-bucket',
        pdf_archive_key: 'test-key',
        pdf_archive_generation: '12345',
        pdf_archive_sha256: validSha256,
      });

      expect(result).toEqual({
        bucket: 'test-bucket',
        key: 'test-key',
        generation: '12345',
        sha256: validSha256,
      });
    });

    it('throws UnprocessableEntityException when any field is empty string or missing', () => {
      expect(() =>
        readArchiveMetadata({
          pdf_archive_bucket: '',
          pdf_archive_key: 'test-key',
          pdf_archive_generation: '12345',
          pdf_archive_sha256: validSha256,
        }),
      ).toThrow(UnprocessableEntityException);

      expect(() =>
        readArchiveMetadata({
          pdf_archive_bucket: 'test-bucket',
          pdf_archive_key: null,
          pdf_archive_generation: '12345',
          pdf_archive_sha256: validSha256,
        }),
      ).toThrow(UnprocessableEntityException);
    });

    it('throws UnprocessableEntityException when sha256 is invalid format', () => {
      expect(() =>
        readArchiveMetadata({
          pdf_archive_bucket: 'test-bucket',
          pdf_archive_key: 'test-key',
          pdf_archive_generation: '12345',
          pdf_archive_sha256: 'not-a-valid-sha256',
        }),
      ).toThrow(UnprocessableEntityException);
    });
  });

  describe('buildArchiveIdentity and buildArchiveKey', () => {
    const validSnapshot = {
      template_version: INVOICE_BRANDED_TEMPLATE_VERSION,
      id: 'inv-123',
    };

    it('builds identity for a branded snapshot', () => {
      const identity = buildArchiveIdentity('tenant-1', 'inv-123', validSnapshot);
      expect(identity).toEqual({
        tenant_id: 'tenant-1',
        invoice_id: 'inv-123',
        snapshot_sha256: hashInvoiceSnapshot(validSnapshot),
        template_version: INVOICE_BRANDED_TEMPLATE_VERSION,
      });
    });

    it('throws UnprocessableEntityException for non-branded snapshot', () => {
      expect(() =>
        buildArchiveIdentity('tenant-1', 'inv-123', {
          template_version: 'other',
        }),
      ).toThrow(UnprocessableEntityException);
    });

    it('builds archive key matching identity fields', () => {
      const identity = buildArchiveIdentity('tenant-1', 'inv-123', validSnapshot);
      const key = buildArchiveKey(identity);
      expect(key).toBe(
        `invoice-archives/tenant-1/inv-123/${identity.snapshot_sha256}/${INVOICE_BRANDED_TEMPLATE_VERSION}.pdf`,
      );
    });
  });

  describe('sameArchiveIdentity', () => {
    const identityA = {
      tenant_id: 'tenant-1',
      invoice_id: 'inv-1',
      snapshot_sha256: 'a'.repeat(64),
      template_version: INVOICE_BRANDED_TEMPLATE_VERSION,
    };

    it('returns true when all fields match', () => {
      expect(sameArchiveIdentity(identityA, { ...identityA })).toBe(true);
    });

    it('returns false when any field differs', () => {
      expect(
        sameArchiveIdentity(identityA, { ...identityA, tenant_id: 'tenant-2' }),
      ).toBe(false);
      expect(
        sameArchiveIdentity(identityA, { ...identityA, invoice_id: 'inv-2' }),
      ).toBe(false);
      expect(
        sameArchiveIdentity(identityA, {
          ...identityA,
          snapshot_sha256: 'b'.repeat(64),
        }),
      ).toBe(false);
      expect(
        sameArchiveIdentity(identityA, {
          ...identityA,
          template_version: 'v2',
        }),
      ).toBe(false);
    });
  });

  describe('getErrorCode', () => {
    it('returns number code if code is number', () => {
      expect(getErrorCode({ code: 412 })).toBe(412);
    });

    it('returns parsed number if code is numeric string', () => {
      expect(getErrorCode({ code: '412' })).toBe(412);
    });

    it('returns undefined if code is non-numeric or missing or null', () => {
      expect(getErrorCode({ code: 'NOT_FOUND' })).toBeUndefined();
      expect(getErrorCode({})).toBeUndefined();
      expect(getErrorCode(null)).toBeUndefined();
      expect(getErrorCode('some string')).toBeUndefined();
      expect(getErrorCode(123)).toBeUndefined();
    });
  });

  describe('verifyFrozenAssetMetadata', () => {
    const logo: InvoiceBrandingLogo = {
      asset_id: 'asset-1',
      bucket: 'logo-bucket',
      key: 'logos/brand.png',
      generation: 'gen-1',
      sha256: 's'.repeat(64),
      mime_type: 'image/png',
      width: 200,
      height: 80,
    };

    const asset: AssetMetadata = {
      bucket: 'logo-bucket',
      object_key: 'logos/brand.png',
      object_generation: 'gen-1',
      sha256: 's'.repeat(64),
      detected_mime_type: 'image/png',
      pixel_width: 200,
      pixel_height: 80,
    };

    it('returns true when asset matches logo metadata', () => {
      expect(verifyFrozenAssetMetadata(asset, logo)).toBe(true);
    });

    it('returns false when asset is null or undefined', () => {
      expect(verifyFrozenAssetMetadata(null, logo)).toBe(false);
      expect(verifyFrozenAssetMetadata(undefined, logo)).toBe(false);
    });

    it('returns false when any property does not match', () => {
      expect(
        verifyFrozenAssetMetadata({ ...asset, bucket: 'other' }, logo),
      ).toBe(false);
      expect(
        verifyFrozenAssetMetadata({ ...asset, object_key: 'other' }, logo),
      ).toBe(false);
      expect(
        verifyFrozenAssetMetadata({ ...asset, object_generation: 'other' }, logo),
      ).toBe(false);
      expect(
        verifyFrozenAssetMetadata({ ...asset, sha256: 'other' }, logo),
      ).toBe(false);
      expect(
        verifyFrozenAssetMetadata(
          { ...asset, detected_mime_type: 'image/jpeg' },
          logo,
        ),
      ).toBe(false);
      expect(
        verifyFrozenAssetMetadata({ ...asset, pixel_width: 199 }, logo),
      ).toBe(false);
      expect(
        verifyFrozenAssetMetadata({ ...asset, pixel_height: 79 }, logo),
      ).toBe(false);
    });
  });

  describe('verifyFrozenLogoHash', () => {
    const bytes = Buffer.from('hello logo');
    const correctHash = createHash('sha256').update(bytes).digest('hex');

    it('returns true when hash matches', () => {
      expect(verifyFrozenLogoHash(bytes, correctHash)).toBe(true);
    });

    it('returns false when hash mismatches', () => {
      expect(verifyFrozenLogoHash(bytes, 'wrong-hash')).toBe(false);
    });
  });

  describe('readArchiveFromMetadata', () => {
    const identity = {
      tenant_id: 'tenant-1',
      invoice_id: 'inv-1',
      snapshot_sha256: 's'.repeat(64),
      template_version: INVOICE_BRANDED_TEMPLATE_VERSION,
    };
    const key = buildArchiveKey(identity);
    const metadata = {
      bucket: 'test-bucket',
      key,
      generation: 'gen-123',
      sha256: 'hash-123',
    };

    it('reads archive successfully when key and identity match', async () => {
      const mockArchive = {
        bucket: metadata.bucket,
        key: metadata.key,
        generation: metadata.generation,
        sha256: metadata.sha256,
        customMetadata: { ...identity },
        body: Buffer.from('pdf content'),
      };
      const storage: Pick<PdfStorage, 'readImmutablePdfGeneration'> = {
        readImmutablePdfGeneration: jest.fn().mockResolvedValue(mockArchive),
      };

      const result = await readArchiveFromMetadata(
        storage as unknown as PdfStorage,
        metadata,
        identity,
      );

      expect(storage.readImmutablePdfGeneration).toHaveBeenCalledWith({
        bucket: metadata.bucket,
        key: metadata.key,
        generation: metadata.generation,
        expectedSha256: metadata.sha256,
      });
      expect(result).toBe(mockArchive);
    });

    it('throws UnprocessableEntityException when key does not match expected identity', async () => {
      const storage: Pick<PdfStorage, 'readImmutablePdfGeneration'> = {
        readImmutablePdfGeneration: jest.fn(),
      };

      await expect(
        readArchiveFromMetadata(
          storage as unknown as PdfStorage,
          { ...metadata, key: 'wrong-key' },
          identity,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws UnprocessableEntityException when customMetadata identity does not match', async () => {
      const mockArchive = {
        bucket: metadata.bucket,
        key: metadata.key,
        generation: metadata.generation,
        sha256: metadata.sha256,
        customMetadata: { ...identity, tenant_id: 'other-tenant' },
        body: Buffer.from('pdf content'),
      };
      const storage: Pick<PdfStorage, 'readImmutablePdfGeneration'> = {
        readImmutablePdfGeneration: jest.fn().mockResolvedValue(mockArchive),
      };

      await expect(
        readArchiveFromMetadata(
          storage as unknown as PdfStorage,
          metadata,
          identity,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('toErrorMessage', () => {
    it('returns error.message for Error instances', () => {
      expect(toErrorMessage(new Error('something broke'))).toBe(
        'something broke',
      );
    });

    it('returns String(error) for non-Error instances', () => {
      expect(toErrorMessage('literal string error')).toBe(
        'literal string error',
      );
      expect(toErrorMessage(404)).toBe('404');
      expect(toErrorMessage({ message: 'ignored' })).toBe('[object Object]');
    });
  });

  describe('rethrowStorageNotFound', () => {
    it('rethrows NotFoundException as "Invoice PDF is not generated yet"', () => {
      expect(() =>
        rethrowStorageNotFound(new NotFoundException('Storage key not found')),
      ).toThrow(new NotFoundException('Invoice PDF is not generated yet'));
    });

    it('rethrows other errors unchanged', () => {
      const customError = new Error('GCS connection reset');
      expect(() => rethrowStorageNotFound(customError)).toThrow(customError);
    });
  });

  describe('clearInvoiceGenerationError', () => {
    it('updates invoice to nullify pdf_generation_error', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const prisma = { client: { invoice: { updateMany } } };

      await clearInvoiceGenerationError(prisma, 'inv-1', 'tenant-1');
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'inv-1', tenant_id: 'tenant-1' },
        data: { pdf_generation_error: null },
      });
    });
  });

  describe('safeStoreInvoiceGenerationError', () => {
    it('stores trimmed error message up to 2000 chars', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const prisma = { client: { invoice: { updateMany } } };
      const logger = { error: jest.fn() };

      const longMessage = 'x'.repeat(2500);
      await safeStoreInvoiceGenerationError(
        prisma,
        logger,
        'inv-1',
        'tenant-1',
        longMessage,
      );

      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'inv-1', tenant_id: 'tenant-1' },
        data: { pdf_generation_error: 'x'.repeat(2000) },
      });
    });

    it('logs error if storing error fails', async () => {
      const updateMany = jest.fn().mockRejectedValue(new Error('DB unreachable'));
      const prisma = { client: { invoice: { updateMany } } };
      const logger = { error: jest.fn() };

      await safeStoreInvoiceGenerationError(
        prisma,
        logger,
        'inv-1',
        'tenant-1',
        'failed',
      );

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to store invoice PDF generation error'),
        expect.any(String),
      );
    });
  });

  describe('persistInvoiceGeneratedPdf', () => {
    it('updates invoice with pdf storage metadata', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const prisma = { client: { invoice: { updateMany } } };
      const date = new Date();

      await persistInvoiceGeneratedPdf(
        prisma,
        'inv-1',
        'tenant-1',
        { bucket: 'test-bucket', key: 'invoices/inv-1.pdf' },
        date,
      );

      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'inv-1', tenant_id: 'tenant-1' },
        data: {
          pdf_storage_key: 'invoices/inv-1.pdf',
          pdf_storage_bucket: 'test-bucket',
          pdf_generation_error: null,
          pdf_generated_at: date,
        },
      });
    });

    it('throws NotFoundException if no invoice was updated', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 0 });
      const prisma = { client: { invoice: { updateMany } } };

      await expect(
        persistInvoiceGeneratedPdf(
          prisma,
          'inv-1',
          'tenant-1',
          { bucket: 'b', key: 'k' },
          new Date(),
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('backfillInvoicePdfMetadata', () => {
    it('persists metadata successfully', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const prisma = { client: { invoice: { updateMany } } };
      const logger = { warn: jest.fn() };

      await backfillInvoicePdfMetadata(
        prisma,
        logger,
        'inv-1',
        'tenant-1',
        'bucket',
        'key',
      );

      expect(updateMany).toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('warns on failure without throwing', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 0 });
      const prisma = { client: { invoice: { updateMany } } };
      const logger = { warn: jest.fn() };

      await expect(
        backfillInvoicePdfMetadata(
          prisma,
          logger,
          'inv-1',
          'tenant-1',
          'bucket',
          'key',
        ),
      ).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to backfill invoice PDF metadata'),
      );
    });
  });

  describe('uploadInvoicePdf', () => {
    it('renders snapshot and uploads to pdf storage', async () => {
      const storage = {
        uploadPdf: jest.fn().mockResolvedValue({ bucket: 'b', key: 'k' }),
      };
      const renderer = {
        render: jest.fn().mockResolvedValue(Buffer.from('pdf-content')),
      };
      const onRetry = jest.fn();

      const result = await uploadInvoicePdf(
        storage as unknown as PdfStorage,
        renderer as unknown as InvoicePdfRenderer,
        {} as any,
        'k',
        onRetry,
      );

      expect(renderer.render).toHaveBeenCalled();
      expect(storage.uploadPdf).toHaveBeenCalledWith({
        key: 'k',
        body: Buffer.from('pdf-content'),
        contentType: 'application/pdf',
      });
      expect(result).toEqual({ bucket: 'b', key: 'k' });
    });
  });

  describe('dispatchInvoiceGeneration', () => {
    it('enqueues generation when cloud tasks is enabled', async () => {
      const cloudTasks = {
        isEnabled: jest.fn().mockReturnValue(true),
        enqueuePdfGeneration: jest.fn().mockResolvedValue({ taskId: 'task-1' }),
      };
      const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
      const clearError = jest.fn().mockResolvedValue(undefined);
      const generateInline = jest.fn();
      const storeEnqueueError = jest.fn();
      const onEnqueueError = jest.fn();

      const outcome = await dispatchInvoiceGeneration({
        invoiceId: 'inv-1',
        tenantId: 'tenant-1',
        targetBaseUrl: 'https://example.com',
        cloudTasks: cloudTasks as unknown as CloudTasksService,
        logger: logger as any,
        clearError,
        generateInline,
        storeEnqueueError,
        onEnqueueError,
      });

      expect(outcome).toEqual({ mode: 'enqueued', taskId: 'task-1' });
      expect(clearError).toHaveBeenCalled();
    });
  });

  describe('toPdfStreamResult', () => {
    it('creates stream result with defaults', async () => {
      const stream = (await import('node:stream')).Readable.from(['data']);
      const result = toPdfStreamResult(
        { contentLength: 4, stream },
        'invoice.pdf',
      );
      expect(result).toEqual({
        filename: 'invoice.pdf',
        contentType: 'application/pdf',
        contentLength: 4,
        stream,
      });
    });
  });

  describe('formatRequestGenerationOutcome', () => {
    it('formats enqueued outcome', () => {
      const outcome = formatRequestGenerationOutcome(
        { mode: 'enqueued', taskId: 't-1' },
        'inv-1',
      );
      expect(outcome).toEqual({
        mode: 'enqueued',
        invoiceId: 'inv-1',
        bucket: null,
        key: null,
        generatedAt: null,
        taskId: 't-1',
      });
    });

    it('formats generated outcome with bucket and key for standard invoices', () => {
      const date = new Date();
      const outcome = formatRequestGenerationOutcome(
        {
          mode: 'generated',
          result: { bucket: 'b', key: 'k', generatedAt: date },
        },
        'inv-1',
        false,
      );
      expect(outcome).toEqual({
        mode: 'generated',
        invoiceId: 'inv-1',
        bucket: 'b',
        key: 'k',
        generatedAt: date,
      });
    });

    it('redacts bucket and key for branded invoices', () => {
      const date = new Date();
      const outcome = formatRequestGenerationOutcome(
        {
          mode: 'generated',
          bucket: 'b',
          key: 'k',
          generatedAt: date,
        },
        'inv-1',
        true,
      );
      expect(outcome).toEqual({
        mode: 'generated',
        invoiceId: 'inv-1',
        bucket: null,
        key: null,
        generatedAt: date,
      });
    });
  });

  describe('loadFrozenLogo', () => {
    it('returns undefined if snapshot has no logo', async () => {
      const prisma = { client: { invoiceBrandAssetReference: { findFirst: jest.fn() } } };
      const result = await loadFrozenLogo(
        prisma as any,
        undefined,
        { id: 'inv-1', tenant_id: 't-1', legal_entity_id: 'le-1' },
        {} as any,
      );
      expect(result).toBeUndefined();
    });

    it('throws when branding storage or legal entity is missing', async () => {
      const prisma = { client: { invoiceBrandAssetReference: { findFirst: jest.fn() } } };
      await expect(
        loadFrozenLogo(
          prisma as any,
          undefined,
          { id: 'inv-1', tenant_id: 't-1', legal_entity_id: null },
          { branding: { logo: { asset_id: 'a1' } } } as any,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('persistBrandedArchiveMetadata', () => {
    it('persists archive metadata successfully', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const prisma = { client: { invoice: { updateMany } } };
      const date = new Date();
      const archive = {
        bucket: 'b',
        key: 'k',
        generation: 'g',
        sha256: 's',
      };

      await persistBrandedArchiveMetadata(
        prisma as any,
        'inv-1',
        't-1',
        archive as any,
        date,
      );

      expect(updateMany).toHaveBeenCalledWith({
        where: {
          id: 'inv-1',
          tenant_id: 't-1',
          pdf_archive_bucket: null,
          pdf_archive_key: null,
          pdf_archive_generation: null,
          pdf_archive_sha256: null,
        },
        data: {
          pdf_archive_bucket: 'b',
          pdf_archive_key: 'k',
          pdf_archive_generation: 'g',
          pdf_archive_sha256: 's',
          pdf_generated_at: date,
          pdf_generation_error: null,
        },
      });
    });
  });

  describe('object parameter compatibility', () => {
    it('supports object parameters for persistInvoiceGeneratedPdf', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const prisma = { client: { invoice: { updateMany } } };
      const date = new Date();

      await persistInvoiceGeneratedPdf({
        prisma: prisma as any,
        invoiceId: 'inv-1',
        tenantId: 'tenant-1',
        upload: { bucket: 'b', key: 'k' },
        generatedAt: date,
      });

      expect(updateMany).toHaveBeenCalled();
    });

    it('supports object parameters for safeStoreInvoiceGenerationError', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const prisma = { client: { invoice: { updateMany } } };
      const logger = { error: jest.fn() };

      await safeStoreInvoiceGenerationError({
        prisma: prisma as any,
        logger,
        invoiceId: 'inv-1',
        tenantId: 'tenant-1',
        message: 'err',
      });

      expect(updateMany).toHaveBeenCalled();
    });
  });
});



