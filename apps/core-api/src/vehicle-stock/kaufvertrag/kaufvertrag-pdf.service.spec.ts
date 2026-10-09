import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { VehicleSaleKaufvertragPdfService } from './kaufvertrag-pdf.service.js';
import {
  buildKaufvertragArchiveIdentity,
  buildKaufvertragArchiveKey,
  KAUFVERTRAG_TEMPLATE_VERSION,
} from './kaufvertrag-snapshot.js';

const TENANT_ID = 'tenant-1';
const OTHER_TENANT_ID = 'tenant-2';
const SITE_ID = 'site-1';
const SALE_ID = 'sale-1';
const PDF_BYTES = Buffer.from('%PDF-1.4 kaufvertrag fixture');
const PDF_SHA256 = 'f'.repeat(64);
const WORKER_BASE_URL = 'https://worker.example.test';

const LEGAL_ENTITY = {
  id: 'legal-entity-1',
  tenant_id: TENANT_ID,
  name: 'Demo Autohaus GmbH',
  country_iso: 'AT',
  address_street: 'Musterweg 1',
  address_line2: null,
  address_zip: '1010',
  address_city: 'Wien',
  tax_number: '123/4567',
  vat_id: 'ATU12345678',
  iban: null,
  bic: null,
  bank_name: null,
  email: null,
  phone: null,
  registration_number: 'FN 123456a',
  registration_court: 'Handelsgericht Wien',
  representatives: 'Max Mustermann',
};

function loadedSale(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SALE_ID,
    tenant_id: TENANT_ID,
    site_id: SITE_ID,
    sale_number: 'VS-2026-0001',
    status: 'DRAFT' as const,
    sale_price: new Prisma.Decimal('18500'),
    contract_concluded_at: new Date('2026-10-02T00:00:00.000Z'),
    handed_over_at: new Date('2026-10-08T00:00:00.000Z'),
    buyer_is_consumer: true,
    gewaehrleistung_shortened_negotiated: false,
    gewaehrleistung_ends_on: new Date('2028-10-08T00:00:00.000Z'),
    presumption_ends_on: new Date('2027-10-08T00:00:00.000Z'),
    gewaehrleistung_rule_version: 'at-used-vehicle-vgg-2026-10-v2',
    garantie_months: null as number | null,
    garantie_terms: null as string | null,
    kaufvertrag_snapshot_sha256: null as string | null,
    kaufvertrag_archive_bucket: null as string | null,
    kaufvertrag_archive_key: null as string | null,
    kaufvertrag_archive_generation: null as string | null,
    kaufvertrag_archive_sha256: null as string | null,
    kaufvertrag_generated_at: null as Date | null,
    vehicle: {
      make: 'Demo',
      model: 'Compact 1.0',
      vin: 'DEMOVIN0000000001',
      hsn: '1234',
      tsn: 'ABC',
      color: 'Grau',
      mileage: 84500,
      first_registration_date: new Date('2020-10-08T00:00:00.000Z'),
    },
    customer: {
      type: 'PRIVATE' as const,
      company_name: null,
      first_name: 'Erika',
      last_name: 'Musterfrau',
      vat_id: null,
      address_street: 'Beispielgasse 2',
      address_zip: '4020',
      address_city: 'Linz',
      address_country: 'AT',
    },
    site: { id: SITE_ID, legal_entity: LEGAL_ENTITY },
    ...overrides,
  };
}

function storedFromUpdate(data: Record<string, unknown>) {
  return {
    kaufvertrag_snapshot_sha256: data.kaufvertrag_snapshot_sha256 as string,
    kaufvertrag_archive_bucket: data.kaufvertrag_archive_bucket as string,
    kaufvertrag_archive_key: data.kaufvertrag_archive_key as string,
    kaufvertrag_archive_generation: data.kaufvertrag_archive_generation as string,
    kaufvertrag_archive_sha256: data.kaufvertrag_archive_sha256 as string,
    kaufvertrag_generated_at: data.kaufvertrag_generated_at as Date,
  };
}

function createHarness(sale: unknown, options: { cloudTasks?: boolean } = {}) {
  const vehicleSale = {
    findFirst: jest.fn().mockResolvedValue(sale),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const tx = {
    documentBrandProfile: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const prisma = {
    client: { vehicleSale },
    $transaction: jest.fn((callback: (txClient: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const renderer = {
    render: jest.fn().mockResolvedValue(PDF_BYTES),
  };
  const storage = {
    publishImmutableObject: jest.fn(
      async (params: { key: string; customMetadata: Record<string, string> }) => ({
        bucket: 'pdf-archive-bucket',
        key: params.key,
        generation: '101',
        sha256: PDF_SHA256,
        customMetadata: { ...params.customMetadata, pdf_sha256: PDF_SHA256 },
      }),
    ),
    readImmutableObjectByKey: jest.fn(),
    readImmutableObjectGeneration: jest.fn(
      async (params: {
        bucket: string;
        key: string;
        generation: string;
        expectedSha256: string;
      }) => ({
        bucket: params.bucket,
        key: params.key,
        generation: params.generation,
        sha256: params.expectedSha256,
        customMetadata: {},
        body: PDF_BYTES,
      }),
    ),
  };
  const cloudTasks = {
    isEnabled: jest.fn().mockReturnValue(options.cloudTasks ?? false),
    enqueuePdfGeneration: jest.fn().mockResolvedValue({ taskId: 'task-1' }),
  };
  const tenantContext = {
    getTenantId: jest.fn().mockResolvedValue(TENANT_ID),
  };
  const siteContext = {
    listAuthorizedSiteIds: jest.fn().mockResolvedValue([SITE_ID]),
  };

  const service = new VehicleSaleKaufvertragPdfService(
    prisma as never,
    renderer as never,
    storage as never,
    cloudTasks as never,
    tenantContext as never,
    siteContext as never,
    undefined,
  );

  return { service, prisma, vehicleSale, renderer, storage, cloudTasks, tenantContext, siteContext };
}

describe('VehicleSaleKaufvertragPdfService', () => {
  const originalBucket = process.env.INVOICE_PDF_BUCKET;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.INVOICE_PDF_BUCKET = 'pdf-archive-bucket';
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    if (originalBucket === undefined) delete process.env.INVOICE_PDF_BUCKET;
    else process.env.INVOICE_PDF_BUCKET = originalBucket;
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('request guards', () => {
    it('refuses a negotiated one-year period the vehicle cannot support, before dispatch or archive writes', async () => {
      const harness = createHarness(
        loadedSale({
          gewaehrleistung_shortened_negotiated: true,
          vehicle: {
            ...loadedSale().vehicle,
            first_registration_date: new Date('2026-06-01T00:00:00.000Z'),
          },
        }),
      );

      await expect(
        harness.service.requestGeneration(SALE_ID, { targetBaseUrl: WORKER_BASE_URL }),
      ).rejects.toMatchObject({
        response: { code: 'GEWAEHRLEISTUNG_SHORTENING_VEHICLE_TOO_NEW' },
      });
      expect(harness.cloudTasks.enqueuePdfGeneration).not.toHaveBeenCalled();
      expect(harness.renderer.render).not.toHaveBeenCalled();
      expect(harness.storage.publishImmutableObject).not.toHaveBeenCalled();
      expect(harness.vehicleSale.updateMany).not.toHaveBeenCalled();
    });

    it('refuses a cancelled sale', async () => {
      const harness = createHarness(loadedSale({ status: 'CANCELLED' }));

      await expect(
        harness.service.requestGeneration(SALE_ID, { targetBaseUrl: '' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      await expect(
        harness.service.requestGeneration(SALE_ID, { targetBaseUrl: '' }),
      ).rejects.toMatchObject({ response: { code: 'KAUFVERTRAG_SALE_CANCELLED' } });
    });

    it('refuses a sale without a site and therefore without a seller', async () => {
      const harness = createHarness(loadedSale({ site: null }));

      await expect(
        harness.service.requestGeneration(SALE_ID, { targetBaseUrl: '' }),
      ).rejects.toMatchObject({ response: { code: 'KAUFVERTRAG_SITE_REQUIRED' } });
    });

    it('refuses a stored Gewährleistung snapshot that no longer matches the sale facts', async () => {
      const harness = createHarness(
        loadedSale({
          gewaehrleistung_ends_on: new Date('2028-10-07T00:00:00.000Z'),
        }),
      );

      await expect(
        harness.service.requestGeneration(SALE_ID, { targetBaseUrl: '' }),
      ).rejects.toMatchObject({
        response: { code: 'KAUFVERTRAG_GEWAEHRLEISTUNG_SNAPSHOT_STALE' },
      });
    });

    it('scopes the request-path lookup to the tenant and the authorized sites', async () => {
      const harness = createHarness(loadedSale());

      await harness.service.requestGeneration(SALE_ID, { targetBaseUrl: '' });

      expect(harness.vehicleSale.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: SALE_ID,
            tenant_id: TENANT_ID,
            site_id: { in: [SITE_ID] },
            vehicle: {
              is: { tenant_id: TENANT_ID, site_id: { in: [SITE_ID] } },
            },
          }),
        }),
      );
    });

    it('reports a sale outside the caller scope as not found', async () => {
      const harness = createHarness(null);

      await expect(
        harness.service.requestGeneration('other-sale', { targetBaseUrl: '' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('generation and archive', () => {
    it('generates inline when Cloud Tasks is not configured and persists the archive pointer for the tenant', async () => {
      const harness = createHarness(loadedSale());

      const outcome = await harness.service.requestGeneration(SALE_ID, {
        targetBaseUrl: '',
      });

      expect(outcome).toMatchObject({
        mode: 'generated',
        saleId: SALE_ID,
        bucket: 'pdf-archive-bucket',
      });
      const expectedIdentity = buildKaufvertragArchiveIdentity({
        tenantId: TENANT_ID,
        saleId: SALE_ID,
        snapshotSha256: harness.vehicleSale.updateMany.mock.calls[0][0].data
          .kaufvertrag_snapshot_sha256,
      });
      expect(harness.storage.publishImmutableObject).toHaveBeenCalledWith(
        expect.objectContaining({
          key: expect.stringMatching(
            new RegExp(
              `^vehicle-sale-kaufvertrag-archives/${TENANT_ID}/${SALE_ID}/[a-f0-9]{64}/${KAUFVERTRAG_TEMPLATE_VERSION}\\.pdf$`,
            ),
          ),
          body: PDF_BYTES,
          contentType: 'application/pdf',
          customMetadata: expectedIdentity,
        }),
      );
      expect(harness.vehicleSale.updateMany).toHaveBeenCalledWith({
        where: { id: SALE_ID, tenant_id: TENANT_ID },
        data: expect.objectContaining({
          kaufvertrag_archive_bucket: 'pdf-archive-bucket',
          kaufvertrag_archive_generation: '101',
          kaufvertrag_archive_sha256: PDF_SHA256,
          kaufvertrag_generation_error: null,
        }),
      });
    });

    it('returns the cached archive without rendering when the snapshot is unchanged', async () => {
      const first = createHarness(loadedSale());
      await first.service.requestGeneration(SALE_ID, { targetBaseUrl: '' });
      const stored = storedFromUpdate(first.vehicleSale.updateMany.mock.calls[0][0].data);

      const second = createHarness(loadedSale(stored));
      const outcome = await second.service.requestGeneration(SALE_ID, {
        targetBaseUrl: '',
      });

      expect(outcome).toMatchObject({
        mode: 'cached',
        bucket: 'pdf-archive-bucket',
        key: stored.kaufvertrag_archive_key,
      });
      expect(second.renderer.render).not.toHaveBeenCalled();
      expect(second.cloudTasks.enqueuePdfGeneration).not.toHaveBeenCalled();
    });

    it('creates a new archive when the sale facts change after the last archive', async () => {
      const first = createHarness(loadedSale());
      await first.service.requestGeneration(SALE_ID, { targetBaseUrl: '' });
      const stored = storedFromUpdate(first.vehicleSale.updateMany.mock.calls[0][0].data);

      const changed = createHarness(
        loadedSale({
          ...stored,
          garantie_months: 12,
          garantie_terms: 'Motorschaden ausgenommen',
        }),
      );
      const outcome = await changed.service.requestGeneration(SALE_ID, {
        targetBaseUrl: '',
      });

      expect(outcome.mode).toBe('generated');
      expect(outcome).toMatchObject({ key: expect.any(String) });
      expect(outcome.key).not.toBe(stored.kaufvertrag_archive_key);
    });

    it('enqueues the worker task when Cloud Tasks is configured', async () => {
      const harness = createHarness(loadedSale(), { cloudTasks: true });

      const outcome = await harness.service.requestGeneration(SALE_ID, {
        targetBaseUrl: WORKER_BASE_URL,
      });

      expect(outcome).toMatchObject({ mode: 'enqueued', taskId: 'task-1' });
      expect(harness.cloudTasks.enqueuePdfGeneration).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'vehicle-sale-kaufvertrag',
          resourceId: SALE_ID,
          tenantId: TENANT_ID,
          targetBaseUrl: WORKER_BASE_URL,
        }),
      );
      expect(harness.renderer.render).not.toHaveBeenCalled();
    });

    it('worker generation reads only by tenant so a signed task can finish after the request', async () => {
      const harness = createHarness(loadedSale());

      await harness.service.generateNow(SALE_ID);

      expect(harness.vehicleSale.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: SALE_ID, tenant_id: TENANT_ID },
        }),
      );
    });

    it('adopts the existing object when create-only publication loses, after verifying its identity', async () => {
      const harness = createHarness(loadedSale());
      harness.storage.publishImmutableObject.mockRejectedValueOnce(
        Object.assign(new Error('precondition failed'), { code: 412 }),
      );
      harness.storage.readImmutableObjectByKey.mockImplementation(
        async (params: { key: string }) => ({
          bucket: 'pdf-archive-bucket',
          key: params.key,
          generation: '55',
          sha256: PDF_SHA256,
          customMetadata: {},
          body: PDF_BYTES,
        }),
      );

      const outcome = await harness.service.generateNow(SALE_ID);

      expect(outcome.generatedAt).toBeInstanceOf(Date);
      expect(harness.storage.readImmutableObjectByKey).toHaveBeenCalledTimes(1);
      const { validateMetadata } =
        harness.storage.readImmutableObjectByKey.mock.calls[0][0];
      const identity = harness.storage.publishImmutableObject.mock.calls[0][0].customMetadata;
      expect(validateMetadata(identity)).toBe(true);
      expect(validateMetadata({ ...identity, tenant_id: OTHER_TENANT_ID })).toBe(false);
      expect(validateMetadata({ ...identity, vehicle_sale_id: 'sale-2' })).toBe(false);
      expect(harness.vehicleSale.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ kaufvertrag_archive_generation: '55' }),
        }),
      );
    });

    it('records the generation error for the poll and rethrows when rendering fails', async () => {
      const harness = createHarness(loadedSale());
      harness.renderer.render.mockRejectedValueOnce(new Error('Render timeout'));

      await expect(harness.service.generateNow(SALE_ID)).rejects.toThrow(
        'Render timeout',
      );
      expect(harness.vehicleSale.updateMany).toHaveBeenCalledWith({
        where: { id: SALE_ID, tenant_id: TENANT_ID },
        data: { kaufvertrag_generation_error: 'Render timeout' },
      });
      expect(harness.storage.publishImmutableObject).not.toHaveBeenCalled();
    });

    it('renders the B2B variant without computed end dates', async () => {
      const harness = createHarness(loadedSale({ buyer_is_consumer: false, gewaehrleistung_ends_on: null, presumption_ends_on: null, customer: { ...loadedSale().customer, type: 'COMPANY', company_name: 'Beispiel GmbH' } }));

      await harness.service.generateNow(SALE_ID);

      const snapshot = harness.renderer.render.mock.calls[0][0];
      expect(snapshot.warranty).toMatchObject({
        regime: 'B2B_PER_CONTRACT',
        base_ends_on: null,
        presumption_ends_on: null,
      });
    });
  });

  describe('download', () => {
    it('reports the PDF as not generated until an archive pointer exists', async () => {
      const harness = createHarness(loadedSale());

      await expect(harness.service.getPdf(SALE_ID)).rejects.toMatchObject({
        message: 'Kaufvertrag PDF is not generated yet',
      });
      await expect(harness.service.getPdf(SALE_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('streams the exact archived generation with an identity check built from the stored snapshot', async () => {
      const first = createHarness(loadedSale());
      await first.service.requestGeneration(SALE_ID, { targetBaseUrl: '' });
      const stored = storedFromUpdate(first.vehicleSale.updateMany.mock.calls[0][0].data);

      const harness = createHarness(loadedSale(stored));
      const result = await harness.service.getPdf(SALE_ID);

      expect(result).toMatchObject({
        filename: 'kaufvertrag-VS_2026_0001.pdf',
        contentType: 'application/pdf',
        contentLength: PDF_BYTES.length,
      });
      expect(harness.storage.readImmutableObjectGeneration).toHaveBeenCalledWith(
        expect.objectContaining({
          bucket: 'pdf-archive-bucket',
          key: stored.kaufvertrag_archive_key,
          generation: stored.kaufvertrag_archive_generation,
          expectedSha256: stored.kaufvertrag_archive_sha256,
        }),
      );
      const { validateMetadata } =
        harness.storage.readImmutableObjectGeneration.mock.calls[0][0];
      const identity = buildKaufvertragArchiveIdentity({
        tenantId: TENANT_ID,
        saleId: SALE_ID,
        snapshotSha256: stored.kaufvertrag_snapshot_sha256,
      });
      expect(validateMetadata(identity)).toBe(true);
      expect(validateMetadata({ ...identity, tenant_id: OTHER_TENANT_ID })).toBe(false);
      expect(
        buildKaufvertragArchiveKey({
          tenantId: TENANT_ID,
          saleId: SALE_ID,
          snapshotSha256: stored.kaufvertrag_snapshot_sha256,
        }),
      ).toBe(stored.kaufvertrag_archive_key);
    });

    it('scopes the download lookup to the tenant and the authorized sites', async () => {
      const harness = createHarness(loadedSale());
      await expect(harness.service.getPdf(SALE_ID)).rejects.toBeInstanceOf(NotFoundException);

      expect(harness.vehicleSale.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenant_id: TENANT_ID,
            site_id: { in: [SITE_ID] },
          }),
        }),
      );
    });
  });
});
