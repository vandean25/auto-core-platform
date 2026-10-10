import {
  ConflictException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { WorkshopEstimateStatus } from '@prisma/client';
import { WorkshopEstimatePdfService } from './workshop-estimate-pdf.service.js';
import { hashWorkshopEstimateSnapshot } from './workshop-estimate-snapshot.js';
import {
  buildEstimateSnapshot,
  estimateBrandingFixture,
  sha256Hex,
} from './workshop-estimate.spec.support.js';

const TENANT_ID = 'tenant-1';
const SITE_ID = 'site-1';
const VERSION_ID = 'version-1';
const LEGAL_ENTITY_ID = 'entity-1';
const SCOPE = { tenantId: TENANT_ID, siteId: SITE_ID };
const SAFE_ERROR = 'PDF generation failed. Please try again or contact support.';
const PDF_BYTES = Buffer.from('%PDF-1.4 workshop estimate fixture');
const LOGO_BYTES = Buffer.from('frozen logo fixture');
const ARCHIVED_AT = new Date('2026-10-10T08:05:00.000Z');

const SNAPSHOT = buildEstimateSnapshot();
const SNAPSHOT_SHA256 = hashWorkshopEstimateSnapshot(SNAPSHOT);
const ARCHIVE_KEY = `workshop-estimates/${TENANT_ID}/${VERSION_ID}/${SNAPSHOT_SHA256}.pdf`;

const LOGO_FIXTURE = {
  asset_id: 'asset-1',
  bucket: 'brand-assets',
  key: 'logos/asset-1.png',
  generation: '17',
  sha256: sha256Hex(LOGO_BYTES),
  mime_type: 'image/png' as const,
  width: 120,
  height: 40,
};
const LOGO_ASSET_METADATA = {
  bucket: LOGO_FIXTURE.bucket,
  object_key: LOGO_FIXTURE.key,
  object_generation: LOGO_FIXTURE.generation,
  sha256: LOGO_FIXTURE.sha256,
  detected_mime_type: LOGO_FIXTURE.mime_type,
  pixel_width: LOGO_FIXTURE.width,
  pixel_height: LOGO_FIXTURE.height,
};

function sentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VERSION_ID,
    tenant_id: TENANT_ID,
    version: 1,
    status: WorkshopEstimateStatus.SENT,
    legal_entity_id: LEGAL_ENTITY_ID,
    snapshot: SNAPSHOT,
    snapshot_sha256: SNAPSHOT_SHA256,
    pdf_storage_bucket: null,
    pdf_storage_key: null,
    pdf_archive_generation: null,
    pdf_sha256: null,
    pdf_generated_at: null,
    estimate: { estimate_number: 'KV-2026-0001' },
    ...overrides,
  };
}

function archivedRow(overrides: Record<string, unknown> = {}) {
  return sentRow({
    pdf_storage_bucket: 'test-bucket',
    pdf_storage_key: ARCHIVE_KEY,
    pdf_archive_generation: '42',
    pdf_sha256: sha256Hex(PDF_BYTES),
    pdf_generated_at: ARCHIVED_AT,
    ...overrides,
  });
}

function buildService() {
  const prisma = {
    workshopEstimateVersion: {
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    workshopEstimateBrandAssetReference: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  const renderer = {
    render: jest.fn().mockResolvedValue(PDF_BYTES),
  };
  const storage = {
    publishImmutableObject: jest.fn(
      async (input: {
        key: string;
        body: Buffer;
        customMetadata: Record<string, string>;
      }) => ({
        bucket: 'test-bucket',
        key: input.key,
        generation: '42',
        sha256: sha256Hex(input.body),
        customMetadata: {
          ...input.customMetadata,
          pdf_sha256: sha256Hex(input.body),
        },
      }),
    ),
    readImmutableObjectByKey: jest.fn(),
    readImmutableObjectGeneration: jest.fn(),
  };
  const cloudTasks = {
    isEnabled: jest.fn().mockReturnValue(false),
    enqueuePdfGeneration: jest.fn().mockResolvedValue({ taskId: 'task-1' }),
  };
  const tenantContext = {
    getTenantId: jest.fn().mockResolvedValue(TENANT_ID),
  };
  const brandingStorage = {
    readGeneration: jest.fn(),
  };
  const service = new WorkshopEstimatePdfService(
    prisma as never,
    renderer as never,
    storage as never,
    cloudTasks as never,
    tenantContext as never,
    brandingStorage as never,
  );
  return { service, prisma, renderer, storage, cloudTasks, brandingStorage };
}

describe('WorkshopEstimatePdfService', () => {
  const previousBucket = process.env.INVOICE_PDF_BUCKET;

  beforeEach(() => {
    // The failure paths log by design. Keep the test output readable.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (previousBucket === undefined) {
      delete process.env.INVOICE_PDF_BUCKET;
    } else {
      process.env.INVOICE_PDF_BUCKET = previousBucket;
    }
  });

  describe('requestGeneration', () => {
    it('refuses a DRAFT version before anything is queued, rendered or stored', async () => {
      const { service, prisma, renderer, cloudTasks, storage } = buildService();
      prisma.workshopEstimateVersion.findFirst.mockResolvedValue(
        sentRow({ status: WorkshopEstimateStatus.DRAFT, snapshot: null, snapshot_sha256: null }),
      );

      const error = await service
        .requestGeneration(SCOPE, VERSION_ID, { targetBaseUrl: '' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'ESTIMATE_PDF_NOT_SENT',
      });
      expect(renderer.render).not.toHaveBeenCalled();
      expect(cloudTasks.enqueuePdfGeneration).not.toHaveBeenCalled();
      expect(storage.publishImmutableObject).not.toHaveBeenCalled();
    });

    it('serves a stored archive without rendering or queueing again', async () => {
      const { service, prisma, renderer, cloudTasks } = buildService();
      prisma.workshopEstimateVersion.findFirst.mockResolvedValue(archivedRow());

      const result = await service.requestGeneration(SCOPE, VERSION_ID, {
        targetBaseUrl: 'https://worker.example.com/api',
      });

      expect(result).toEqual({
        mode: 'cached',
        versionId: VERSION_ID,
        bucket: 'test-bucket',
        key: ARCHIVE_KEY,
        generatedAt: ARCHIVED_AT,
      });
      expect(renderer.render).not.toHaveBeenCalled();
      expect(cloudTasks.enqueuePdfGeneration).not.toHaveBeenCalled();
    });

    it('renders inline and stores the archive pointer when Cloud Tasks is disabled', async () => {
      const { service, prisma, renderer, storage } = buildService();
      prisma.workshopEstimateVersion.findFirst.mockResolvedValue(sentRow());

      const result = await service.requestGeneration(SCOPE, VERSION_ID, {
        targetBaseUrl: '',
      });

      expect(result).toMatchObject({
        mode: 'generated',
        versionId: VERSION_ID,
        bucket: 'test-bucket',
        key: ARCHIVE_KEY,
      });
      expect(renderer.render).toHaveBeenCalledTimes(1);
      expect(storage.publishImmutableObject).toHaveBeenCalledWith(
        expect.objectContaining({
          key: ARCHIVE_KEY,
          contentType: 'application/pdf',
          customMetadata: {
            tenant_id: TENANT_ID,
            workshop_estimate_version_id: VERSION_ID,
            snapshot_sha256: SNAPSHOT_SHA256,
            document_kind: 'WORKSHOP_ESTIMATE',
          },
        }),
      );
      expect(prisma.workshopEstimateVersion.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: VERSION_ID, tenant_id: TENANT_ID, pdf_storage_key: null },
          data: expect.objectContaining({
            pdf_storage_bucket: 'test-bucket',
            pdf_storage_key: ARCHIVE_KEY,
            pdf_archive_generation: '42',
            pdf_sha256: sha256Hex(PDF_BYTES),
            pdf_generation_error: null,
          }),
        }),
      );
    });

    it('queues the render when Cloud Tasks is enabled and the target is configured', async () => {
      const { service, prisma, renderer, cloudTasks } = buildService();
      cloudTasks.isEnabled.mockReturnValue(true);
      prisma.workshopEstimateVersion.findFirst.mockResolvedValue(sentRow());

      const result = await service.requestGeneration(SCOPE, VERSION_ID, {
        targetBaseUrl: 'https://worker.example.com/api',
      });

      expect(result).toEqual({
        mode: 'enqueued',
        versionId: VERSION_ID,
        taskId: 'task-1',
      });
      expect(cloudTasks.enqueuePdfGeneration).toHaveBeenCalledWith({
        kind: 'workshop-estimate',
        resourceId: VERSION_ID,
        tenantId: TENANT_ID,
        targetBaseUrl: 'https://worker.example.com/api',
      });
      expect(renderer.render).not.toHaveBeenCalled();
    });

    it('looks the version up inside the active site scope', async () => {
      const { service, prisma } = buildService();
      prisma.workshopEstimateVersion.findFirst.mockResolvedValue(null);

      await expect(
        service.requestGeneration(SCOPE, VERSION_ID, { targetBaseUrl: '' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.workshopEstimateVersion.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: VERSION_ID,
            tenant_id: TENANT_ID,
            estimate: { site_id: SITE_ID },
          },
        }),
      );
    });
  });

  describe('generateNow', () => {
    it('never renders a DRAFT version', async () => {
      const { service, prisma, renderer, storage } = buildService();
      prisma.workshopEstimateVersion.findFirst.mockResolvedValue(
        sentRow({ status: WorkshopEstimateStatus.DRAFT }),
      );

      await expect(service.generateNow(VERSION_ID, TENANT_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(renderer.render).not.toHaveBeenCalled();
      expect(storage.publishImmutableObject).not.toHaveBeenCalled();
    });

    it('never re-renders an archive that already exists', async () => {
      const { service, prisma, renderer, storage } = buildService();
      prisma.workshopEstimateVersion.findFirst.mockResolvedValue(archivedRow());

      const result = await service.generateNow(VERSION_ID, TENANT_ID);

      expect(result).toEqual({
        versionId: VERSION_ID,
        bucket: 'test-bucket',
        key: ARCHIVE_KEY,
        generatedAt: ARCHIVED_AT,
      });
      expect(renderer.render).not.toHaveBeenCalled();
      expect(storage.publishImmutableObject).not.toHaveBeenCalled();
      expect(prisma.workshopEstimateVersion.updateMany).not.toHaveBeenCalled();
    });

    it('stores the safe error and skips the render when the stored snapshot no longer matches its hash', async () => {
      const { service, prisma, renderer } = buildService();
      prisma.workshopEstimateVersion.findFirst.mockResolvedValue(
        sentRow({ snapshot_sha256: 'f'.repeat(64) }),
      );

      const error = await service
        .generateNow(VERSION_ID, TENANT_ID)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
        code: 'BRAND_RENDER_INPUT_UNAVAILABLE',
      });
      expect(renderer.render).not.toHaveBeenCalled();
      expect(prisma.workshopEstimateVersion.updateMany).toHaveBeenCalledWith({
        where: { id: VERSION_ID, tenant_id: TENANT_ID },
        data: { pdf_generation_error: SAFE_ERROR },
      });
    });

    it('fails closed when the version does not reference its frozen logo', async () => {
      const { service, prisma, renderer, brandingStorage } = buildService();
      const snapshot = buildEstimateSnapshot({
        branding: { ...estimateBrandingFixture, logo: LOGO_FIXTURE },
      });
      prisma.workshopEstimateVersion.findFirst.mockResolvedValue(
        sentRow({
          snapshot,
          snapshot_sha256: hashWorkshopEstimateSnapshot(snapshot),
        }),
      );
      prisma.workshopEstimateBrandAssetReference.findFirst.mockResolvedValue(null);

      await expect(service.generateNow(VERSION_ID, TENANT_ID)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(brandingStorage.readGeneration).not.toHaveBeenCalled();
      expect(renderer.render).not.toHaveBeenCalled();
    });

    it('fails closed when the stored logo bytes do not match the frozen hash', async () => {
      const { service, prisma, renderer, brandingStorage } = buildService();
      const snapshot = buildEstimateSnapshot({
        branding: { ...estimateBrandingFixture, logo: LOGO_FIXTURE },
      });
      prisma.workshopEstimateVersion.findFirst.mockResolvedValue(
        sentRow({
          snapshot,
          snapshot_sha256: hashWorkshopEstimateSnapshot(snapshot),
        }),
      );
      prisma.workshopEstimateBrandAssetReference.findFirst.mockResolvedValue({
        asset: LOGO_ASSET_METADATA,
      });
      brandingStorage.readGeneration.mockResolvedValue(Buffer.from('tampered'));

      await expect(service.generateNow(VERSION_ID, TENANT_ID)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(renderer.render).not.toHaveBeenCalled();
    });

    it('renders with the verified logo bytes, scoped to the version and legal entity', async () => {
      const { service, prisma, renderer, brandingStorage } = buildService();
      const snapshot = buildEstimateSnapshot({
        branding: { ...estimateBrandingFixture, logo: LOGO_FIXTURE },
      });
      prisma.workshopEstimateVersion.findFirst.mockResolvedValue(
        sentRow({
          snapshot,
          snapshot_sha256: hashWorkshopEstimateSnapshot(snapshot),
        }),
      );
      prisma.workshopEstimateBrandAssetReference.findFirst.mockResolvedValue({
        asset: LOGO_ASSET_METADATA,
      });
      brandingStorage.readGeneration.mockResolvedValue(LOGO_BYTES);

      await service.generateNow(VERSION_ID, TENANT_ID);

      expect(prisma.workshopEstimateBrandAssetReference.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenant_id: TENANT_ID,
            legal_entity_id: LEGAL_ENTITY_ID,
            workshop_estimate_version_id: VERSION_ID,
            asset_id: LOGO_FIXTURE.asset_id,
          },
        }),
      );
      expect(brandingStorage.readGeneration).toHaveBeenCalledWith(
        LOGO_FIXTURE.bucket,
        LOGO_FIXTURE.key,
        LOGO_FIXTURE.generation,
      );
      expect(renderer.render).toHaveBeenCalledWith(
        expect.objectContaining({ logoPng: LOGO_BYTES }),
      );
    });

    it('adopts the identical object an earlier attempt published instead of overwriting it', async () => {
      process.env.INVOICE_PDF_BUCKET = 'test-bucket';
      const { service, prisma, storage } = buildService();
      prisma.workshopEstimateVersion.findFirst.mockResolvedValue(sentRow());
      storage.publishImmutableObject.mockRejectedValue(
        Object.assign(new Error('precondition failed'), { code: 412 }),
      );
      storage.readImmutableObjectByKey.mockResolvedValue({
        bucket: 'test-bucket',
        key: ARCHIVE_KEY,
        generation: '41',
        sha256: sha256Hex(PDF_BYTES),
        customMetadata: {},
      });

      const result = await service.generateNow(VERSION_ID, TENANT_ID);

      expect(storage.publishImmutableObject).toHaveBeenCalledTimes(1);
      expect(storage.readImmutableObjectByKey).toHaveBeenCalledWith({
        bucket: 'test-bucket',
        key: ARCHIVE_KEY,
        validateMetadata: expect.any(Function),
      });
      expect(result).toMatchObject({ bucket: 'test-bucket', key: ARCHIVE_KEY });
      expect(prisma.workshopEstimateVersion.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ pdf_archive_generation: '41' }),
        }),
      );

      const { validateMetadata } = storage.readImmutableObjectByKey.mock.calls[0][0] as {
        validateMetadata: (metadata: Record<string, string>) => boolean;
      };
      expect(
        validateMetadata({
          tenant_id: TENANT_ID,
          workshop_estimate_version_id: VERSION_ID,
          snapshot_sha256: SNAPSHOT_SHA256,
          document_kind: 'WORKSHOP_ESTIMATE',
        }),
      ).toBe(true);
      expect(
        validateMetadata({
          tenant_id: 'tenant-2',
          workshop_estimate_version_id: VERSION_ID,
          snapshot_sha256: SNAPSHOT_SHA256,
          document_kind: 'WORKSHOP_ESTIMATE',
        }),
      ).toBe(false);
    });

    it('returns the archive that a concurrent worker stored first', async () => {
      const { service, prisma, renderer } = buildService();
      prisma.workshopEstimateVersion.findFirst
        .mockResolvedValueOnce(sentRow())
        .mockResolvedValueOnce(archivedRow());
      prisma.workshopEstimateVersion.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.generateNow(VERSION_ID, TENANT_ID);

      expect(renderer.render).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        versionId: VERSION_ID,
        bucket: 'test-bucket',
        key: ARCHIVE_KEY,
        generatedAt: ARCHIVED_AT,
      });
    });

    it('stores only the safe error text when rendering fails, and rethrows', async () => {
      const { service, prisma, renderer } = buildService();
      prisma.workshopEstimateVersion.findFirst.mockResolvedValue(sentRow());
      renderer.render.mockRejectedValue(new Error('chromium crashed at /secret/path'));

      await expect(service.generateNow(VERSION_ID, TENANT_ID)).rejects.toThrow(
        'chromium crashed',
      );
      expect(prisma.workshopEstimateVersion.updateMany).toHaveBeenCalledWith({
        where: { id: VERSION_ID, tenant_id: TENANT_ID },
        data: { pdf_generation_error: SAFE_ERROR },
      });
      expect(JSON.stringify(prisma.workshopEstimateVersion.updateMany.mock.calls)).not.toContain(
        'chromium crashed',
      );
    });
  });

  describe('getPdf', () => {
    it('reports that the PDF is not generated while no archive pointer exists', async () => {
      const { service, prisma, storage } = buildService();
      prisma.workshopEstimateVersion.findFirst.mockResolvedValue(sentRow());

      await expect(service.getPdf(SCOPE, VERSION_ID)).rejects.toThrow(
        'Estimate PDF is not generated yet',
      );
      expect(storage.readImmutableObjectGeneration).not.toHaveBeenCalled();
    });

    it('verifies the archive identity and checksum before streaming the bytes', async () => {
      const { service, prisma, storage } = buildService();
      prisma.workshopEstimateVersion.findFirst.mockResolvedValue(archivedRow());
      storage.readImmutableObjectGeneration.mockResolvedValue({
        bucket: 'test-bucket',
        key: ARCHIVE_KEY,
        generation: '42',
        sha256: sha256Hex(PDF_BYTES),
        customMetadata: {},
        body: PDF_BYTES,
      });

      const result = await service.getPdf(SCOPE, VERSION_ID);

      expect(result.filename).toBe('Kostenvoranschlag-KV-2026-0001-v1.pdf');
      expect(result.contentType).toBe('application/pdf');
      expect(result.contentLength).toBe(PDF_BYTES.length);
      expect(storage.readImmutableObjectGeneration).toHaveBeenCalledWith(
        expect.objectContaining({
          bucket: 'test-bucket',
          key: ARCHIVE_KEY,
          generation: '42',
          expectedSha256: sha256Hex(PDF_BYTES),
        }),
      );

      const { validateMetadata } = storage.readImmutableObjectGeneration.mock.calls[0][0] as {
        validateMetadata: (metadata: Record<string, string>) => boolean;
      };
      expect(
        validateMetadata({
          tenant_id: TENANT_ID,
          workshop_estimate_version_id: VERSION_ID,
          snapshot_sha256: SNAPSHOT_SHA256,
          document_kind: 'WORKSHOP_ESTIMATE',
        }),
      ).toBe(true);
      expect(
        validateMetadata({
          tenant_id: TENANT_ID,
          workshop_estimate_version_id: VERSION_ID,
          snapshot_sha256: 'e'.repeat(64),
          document_kind: 'WORKSHOP_ESTIMATE',
        }),
      ).toBe(false);
    });

    it('refuses an archive whose key does not follow the frozen snapshot', async () => {
      const { service, prisma, storage } = buildService();
      prisma.workshopEstimateVersion.findFirst.mockResolvedValue(
        archivedRow({ pdf_storage_key: `workshop-estimates/${TENANT_ID}/${VERSION_ID}/other.pdf` }),
      );

      await expect(service.getPdf(SCOPE, VERSION_ID)).rejects.toThrow(
        'Estimate archive reference is inconsistent.',
      );
      expect(storage.readImmutableObjectGeneration).not.toHaveBeenCalled();
    });
  });
});
