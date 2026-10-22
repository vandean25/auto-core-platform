import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  CostBearer,
  ImportEntityType,
  LegacyDocumentLineType,
  LegacyDocumentOrigin,
  LegacyDocumentType,
  MigrationRunStatus,
  Prisma,
} from '@prisma/client';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestTenant, runWithTenantContext } from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('legacy migration schema M2 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantAId: string;
  let tenantBId: string;
  let legalEntityAId: string;
  let legalEntityBId: string;

  const prefix = `e2e-legacy-m2-${Date.now()}`;
  const sourceSystem = 'legacy-dms';
  const payloadSha = 'a'.repeat(64);
  const manifestSha = 'b'.repeat(64);

  function inTenant<T>(tenantId: string, query: () => Promise<T>): Promise<T> {
    return runWithTenantContext(tenantId, async () => await query());
  }

  const importJobDefaults = {
    entity_type: ImportEntityType.LEGACY_INVOICE,
    source_system: sourceSystem,
    file_name: 'synthetic.csv',
    file_sha256: 'c'.repeat(64),
    mapping_json: {},
    options_json: {},
    totals_json: {},
  };

  const documentDefaults = {
    source_system: sourceSystem,
    origin: LegacyDocumentOrigin.PRIOR_SYSTEM,
    doc_no: 'DOC-1',
    doc_date: new Date('2024-06-01'),
    currency: 'EUR',
    net_total: new Prisma.Decimal('100.00'),
    vat_total: new Prisma.Decimal('20.00'),
    gross_total: new Prisma.Decimal('120.00'),
    payload_json: { synthetic: true },
    payload_sha256: payloadSha,
    retain_until: new Date('2031-12-31'),
    legal_hold: false,
  };

  async function createImportJob(tenantId: string, migrationRunId?: string) {
    return inTenant(tenantId, () =>
      prisma.importJob.create({
        data: {
          tenant_id: tenantId,
          ...importJobDefaults,
          migration_run_id: migrationRunId ?? null,
        },
      }),
    );
  }

  async function createMigrationRun(tenantId: string, legalEntityId: string) {
    return inTenant(tenantId, () =>
      prisma.migrationRun.create({
        data: {
          tenant_id: tenantId,
          source_system: sourceSystem,
          legal_entity_id: legalEntityId,
          name: `${prefix}-run`,
          cutover_date: new Date('2024-12-31'),
          status: MigrationRunStatus.DRAFT,
          manifest_json: { rows: 0 },
          manifest_sha256: manifestSha,
        },
      }),
    );
  }

  async function createLegacyDocument(
    tenantId: string,
    importJobId: string,
    overrides: {
      external_id: string;
      doc_type: LegacyDocumentType;
      migration_run_id?: string | null;
    },
  ) {
    return inTenant(tenantId, () =>
      prisma.legacyDocument.create({
        data: {
          tenant_id: tenantId,
          import_job_id: importJobId,
          ...documentDefaults,
          ...overrides,
        },
      }),
    );
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    const tenantA = await createTestTenant(prisma, `${prefix}-a`);
    const tenantB = await createTestTenant(prisma, `${prefix}-b`);
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;

    legalEntityAId = (
      await inTenant(tenantAId, () =>
        prisma.legalEntity.findFirstOrThrow({ where: {} }),
      )
    ).id;
    legalEntityBId = (
      await inTenant(tenantBId, () =>
        prisma.legalEntity.findFirstOrThrow({ where: {} }),
      )
    ).id;
  });

  afterAll(async () => {
    await teardownTestApp(app);
  });

  it('blocks update of protected legacy document fields', async () => {
    const job = await createImportJob(tenantAId);
    const doc = await createLegacyDocument(tenantAId, job.id, {
      external_id: `${prefix}-inv-1`,
      doc_type: LegacyDocumentType.INVOICE,
    });

    await expect(
      inTenant(tenantAId, () =>
        prisma.$executeRaw`
          UPDATE "legacy_documents"
          SET "payload_json" = '{"tampered":true}'::jsonb
          WHERE "tenant_id" = ${tenantAId} AND "id" = ${doc.id}::uuid
        `,
      ),
    ).rejects.toThrow();
  });

  it('allows legal_hold and superseded_by_run_id updates', async () => {
    const job = await createImportJob(tenantAId);
    const run = await createMigrationRun(tenantAId, legalEntityAId);
    const doc = await createLegacyDocument(tenantAId, job.id, {
      external_id: `${prefix}-inv-hold`,
      doc_type: LegacyDocumentType.INVOICE,
    });

    const updated = await inTenant(tenantAId, () =>
      prisma.legacyDocument.update({
        where: { tenant_id: tenantAId, id: doc.id },
        data: {
          legal_hold: true,
          superseded_by_run_id: run.id,
        },
      }),
    );

    expect(updated.legal_hold).toBe(true);
    expect(updated.superseded_by_run_id).toBe(run.id);
  });

  it('blocks delete without purge flag and allows delete with transaction-local purge flag', async () => {
    const job = await createImportJob(tenantAId);
    const doc = await createLegacyDocument(tenantAId, job.id, {
      external_id: `${prefix}-inv-del`,
      doc_type: LegacyDocumentType.INVOICE,
    });

    await expect(
      inTenant(tenantAId, () =>
        prisma.legacyDocument.delete({
          where: { tenant_id: tenantAId, id: doc.id },
        }),
      ),
    ).rejects.toThrow();

    await inTenant(tenantAId, async () => {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('acp.allow_purge', 'on', true)`;
        await tx.legacyDocument.delete({
          where: { tenant_id: tenantAId, id: doc.id },
        });
      });
    });

    const missing = await inTenant(tenantAId, () =>
      prisma.legacyDocument.findFirst({
        where: { id: doc.id },
      }),
    );
    expect(missing).toBeNull();

    const flagAfter = await prisma.$queryRaw<Array<{ value: string | null }>>`
      SELECT current_setting('acp.allow_purge', true) AS value
    `;
    expect(flagAfter[0]?.value).not.toBe('on');
  });

  it('blocks legacy document line update and delete', async () => {
    const job = await createImportJob(tenantAId);
    const doc = await createLegacyDocument(tenantAId, job.id, {
      external_id: `${prefix}-inv-line`,
      doc_type: LegacyDocumentType.INVOICE,
    });

    await inTenant(tenantAId, () =>
      prisma.legacyDocumentLine.create({
        data: {
          tenant_id: tenantAId,
          legacy_document_id: doc.id,
          line_no: 1,
          line_type: LegacyDocumentLineType.PART,
          code: 'P1',
          description: 'Synthetic part',
          quantity: new Prisma.Decimal('1.000'),
          unit_price: new Prisma.Decimal('10.00'),
          net: new Prisma.Decimal('10.00'),
          vat_rate: new Prisma.Decimal('20.00'),
          payload_json: {},
        },
      }),
    );

    await expect(
      inTenant(tenantAId, () =>
        prisma.legacyDocumentLine.update({
        where: {
          tenant_id: tenantAId,
          legacy_document_id: doc.id,
          line_no: 1,
        },
          data: { description: 'Changed' },
        }),
      ),
    ).rejects.toThrow();

    await expect(
      inTenant(tenantAId, () =>
        prisma.legacyDocumentLine.delete({
        where: {
          tenant_id: tenantAId,
          legacy_document_id: doc.id,
          line_no: 1,
        },
      }),
      ),
    ).rejects.toThrow();
  });

  it('enforces uniqueness for non-open-item documents', async () => {
    const job = await createImportJob(tenantAId);
    await createLegacyDocument(tenantAId, job.id, {
      external_id: `${prefix}-dup`,
      doc_type: LegacyDocumentType.INVOICE,
    });

    await expect(
      createLegacyDocument(tenantAId, job.id, {
        external_id: `${prefix}-dup`,
        doc_type: LegacyDocumentType.INVOICE,
      }),
    ).rejects.toThrow();
  });

  it('allows duplicate open-item external ids across migration runs but not within one run', async () => {
    const runA = await createMigrationRun(tenantAId, legalEntityAId);
    const runB = await createMigrationRun(tenantAId, legalEntityAId);
    const jobA = await createImportJob(tenantAId, runA.id);
    const jobB = await createImportJob(tenantAId, runB.id);
    const externalId = `${prefix}-open-1`;

    await createLegacyDocument(tenantAId, jobA.id, {
      external_id: externalId,
      doc_type: LegacyDocumentType.OPEN_ITEM,
      migration_run_id: runA.id,
    });
    await createLegacyDocument(tenantAId, jobB.id, {
      external_id: externalId,
      doc_type: LegacyDocumentType.OPEN_ITEM,
      migration_run_id: runB.id,
    });

    await expect(
      createLegacyDocument(tenantAId, jobA.id, {
        external_id: externalId,
        doc_type: LegacyDocumentType.OPEN_ITEM,
        migration_run_id: runA.id,
      }),
    ).rejects.toThrow();
  });

  it('rejects composite FK to another tenant customer', async () => {
    const jobA = await createImportJob(tenantAId);
    const customerB = await inTenant(tenantBId, () =>
      prisma.customer.create({
      data: {
        tenant_id: tenantBId,
        first_name: 'Other',
        last_name: 'Tenant',
        email: `${prefix}-cross@example.com`,
      },
    }),
    );

    const attempt = inTenant(tenantAId, () =>
      prisma.legacyDocument.create({
      data: {
        tenant_id: tenantAId,
        import_job_id: jobA.id,
        customer_id: customerB.id,
        ...documentDefaults,
        external_id: `${prefix}-cross-customer`,
        doc_type: LegacyDocumentType.INVOICE,
      },
    }),
    );

    await expect(attempt).rejects.toMatchObject({ code: 'P2003' });
  });

  it('accepts null cost_bearer and rejects invalid enum values on lines', async () => {
    const job = await createImportJob(tenantAId);
    const doc = await createLegacyDocument(tenantAId, job.id, {
      external_id: `${prefix}-cost-bearer`,
      doc_type: LegacyDocumentType.INVOICE,
    });
    const line = await inTenant(tenantAId, () =>
      prisma.legacyDocumentLine.create({
      data: {
        tenant_id: tenantAId,
        legacy_document_id: doc.id,
        line_no: 1,
        line_type: LegacyDocumentLineType.LABOR,
        code: 'L1',
        description: 'Labor',
        quantity: new Prisma.Decimal('1.000'),
        unit_price: new Prisma.Decimal('50.00'),
        net: new Prisma.Decimal('50.00'),
        vat_rate: new Prisma.Decimal('20.00'),
        cost_bearer: null,
        payload_json: { raw_cost_bearer: 'unknown' },
      },
    }),
    );
    expect(line.cost_bearer).toBeNull();

    await expect(
      inTenant(tenantAId, () =>
        prisma.$executeRaw`
          INSERT INTO "legacy_document_lines" (
            "tenant_id", "legacy_document_id", "line_no", "line_type",
            "code", "description", "quantity", "unit_price", "net", "vat_rate", "cost_bearer", "payload_json"
          ) VALUES (
            ${tenantAId}, ${doc.id}::uuid, 2, 'LABOR',
            'L2', 'Bad enum', 1, 10, 10, 20, 'INVALID'::"CostBearer", '{}'::jsonb
          )
        `,
      ),
    ).rejects.toThrow();

    await inTenant(tenantAId, () =>
      prisma.legacyDocumentLine.create({
        data: {
          tenant_id: tenantAId,
          legacy_document_id: doc.id,
          line_no: 3,
          line_type: LegacyDocumentLineType.FEE,
          code: 'F1',
          description: 'Warranty share',
          quantity: new Prisma.Decimal('1.000'),
          unit_price: new Prisma.Decimal('5.00'),
          net: new Prisma.Decimal('5.00'),
          vat_rate: new Prisma.Decimal('20.00'),
          cost_bearer: CostBearer.WARRANTY,
          payload_json: {},
        },
      }),
    );
  });
});
