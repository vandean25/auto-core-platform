import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestTenant,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

type InvoiceBrandAssetReferenceInput = {
  tenant_id: string;
  legal_entity_id: string;
  invoice_id: string;
  asset_id: string;
};

type InvoiceBrandAssetReferenceDelegate = {
  create(args: { data: InvoiceBrandAssetReferenceInput }): Promise<unknown>;
  deleteMany(args: { where: { tenant_id: string } }): Promise<unknown>;
};

function invoiceBrandAssetReferences(
  prisma: PrismaService,
): InvoiceBrandAssetReferenceDelegate {
  return (
    prisma as unknown as {
      invoiceBrandAssetReference: InvoiceBrandAssetReferenceDelegate;
    }
  ).invoiceBrandAssetReference;
}

describe('invoice brand asset reference persistence (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantA: TestTenantResult;
  let tenantB: TestTenantResult;
  let entityA: { id: string };
  let entityA2: { id: string };
  let entityB: { id: string };
  let invoiceA: { id: string };
  let invoiceB: { id: string };
  let assetA: { id: string };
  let assetA2: { id: string };
  let assetAOtherEntity: { id: string };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get<PrismaService>(PrismaService);
  });

  beforeEach(async () => {
    tenantA = await createTestTenant(prisma, 'aut323-ref-a');
    tenantB = await createTestTenant(prisma, 'aut323-ref-b');
    const tenantAPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
    const tenantBPrisma = createTenantAwarePrisma(prisma, tenantB.tenantId);

    entityA = await tenantAPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantA.tenantId },
      select: { id: true },
    });
    entityA2 = await tenantAPrisma.legalEntity.create({
      data: {
        tenant_id: tenantA.tenantId,
        name: `AUT-323 Second Entity ${tenantA.tenantId}`,
        country_iso: 'AT',
      },
      select: { id: true },
    });
    entityB = await tenantBPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantB.tenantId },
      select: { id: true },
    });
    invoiceA = await createInvoice(tenantA.tenantId, entityA.id);
    invoiceB = await createInvoice(tenantB.tenantId, entityB.id);
    assetA = await createReadyLogo(tenantA.tenantId, entityA.id, 'first');
    assetA2 = await createReadyLogo(tenantA.tenantId, entityA.id, 'second');
    assetAOtherEntity = await createReadyLogo(
      tenantA.tenantId,
      entityA2.id,
      'other-entity',
    );
  });

  afterEach(async () => {
    for (const tenant of [tenantA, tenantB]) {
      if (!tenant) continue;
      const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
      const references = invoiceBrandAssetReferences(tenantPrisma);
      if (references) {
        await references
          .deleteMany({ where: { tenant_id: tenant.tenantId } })
          .catch(() => undefined);
      }
      await tenantPrisma.documentBrandProfile.deleteMany({
        where: { tenant_id: tenant.tenantId },
      });
      await tenantPrisma.documentBrandAsset.deleteMany({
        where: { tenant_id: tenant.tenantId },
      });
      await cleanupTestTenantGraph(prisma, tenant.tenantId).catch(
        () => undefined,
      );
    }
  });

  afterAll(async () => {
    await teardownTestApp(app, prisma);
  });

  it('stores a logo reference for an invoice with matching tenant and legal entity', async () => {
    await expect(
      invoiceBrandAssetReferences(
        createTenantAwarePrisma(prisma, tenantA.tenantId),
      ).create({
        data: {
          tenant_id: tenantA.tenantId,
          legal_entity_id: entityA.id,
          invoice_id: invoiceA.id,
          asset_id: assetA.id,
        },
      }),
    ).resolves.toBeTruthy();
  });

  it('rejects an invoice-logo reference that crosses tenants', async () => {
    await expect(
      invoiceBrandAssetReferences(
        createTenantAwarePrisma(prisma, tenantA.tenantId),
      ).create({
        data: {
          tenant_id: tenantA.tenantId,
          legal_entity_id: entityA.id,
          invoice_id: invoiceB.id,
          asset_id: assetA.id,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('rejects an invoice-logo reference that crosses legal entities', async () => {
    await expect(
      invoiceBrandAssetReferences(
        createTenantAwarePrisma(prisma, tenantA.tenantId),
      ).create({
        data: {
          tenant_id: tenantA.tenantId,
          legal_entity_id: entityA2.id,
          invoice_id: invoiceA.id,
          asset_id: assetAOtherEntity.id,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('allows at most one logo reference for an invoice', async () => {
    const references = invoiceBrandAssetReferences(
      createTenantAwarePrisma(prisma, tenantA.tenantId),
    );
    await references.create({
      data: {
        tenant_id: tenantA.tenantId,
        legal_entity_id: entityA.id,
        invoice_id: invoiceA.id,
        asset_id: assetA.id,
      },
    });

    await expect(
      references.create({
        data: {
          tenant_id: tenantA.tenantId,
          legal_entity_id: entityA.id,
          invoice_id: invoiceA.id,
          asset_id: assetA2.id,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  async function createInvoice(tenantId: string, legalEntityId: string) {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
    const unique = randomUUID();
    const customer = await tenantPrisma.customer.create({
      data: {
        first_name: 'Invoice',
        last_name: unique,
        type: 'PRIVATE',
      },
      select: { id: true },
    });
    return tenantPrisma.invoice.create({
      data: {
        tenant_id: tenantId,
        customer_id: customer.id,
        legal_entity_id: legalEntityId,
        status: 'ISSUED',
        date: new Date(),
        due_date: new Date(),
        total_net: 10,
        total_tax: 2,
        total_gross: 12,
      },
      select: { id: true },
    });
  }

  async function createReadyLogo(
    tenantId: string,
    legalEntityId: string,
    suffix: string,
  ) {
    return createTenantAwarePrisma(prisma, tenantId).documentBrandAsset.create({
      data: {
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        purpose: 'LOGO',
        state: 'READY',
        bucket: 'aut323-test',
        object_key: `logo/${tenantId}/${legalEntityId}/${suffix}.png`,
        object_generation: '1',
        sha256: 'a'.repeat(64),
        byte_length: 1,
        detected_mime_type: 'image/png',
      },
      select: { id: true },
    });
  }
});
