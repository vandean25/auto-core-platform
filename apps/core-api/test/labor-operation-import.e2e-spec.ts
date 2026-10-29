import {
  createImportTestClient,
  setupImportE2eSuite,
} from './helpers/import-e2e-suite.js';
import { createTenantAwarePrisma } from './tenant-test-utils.js';

const SOURCE = 'synthetic-import';
const HEADERS = [
  'external_id',
  'code',
  'description',
  'standard_aw',
  'hourly_rate',
  'internal_cost',
  'category_name',
  'fitment_make',
  'fitment_model',
  'fitment_year_from',
  'fitment_year_to',
  'fitment_engine_code',
];

function laborRow(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    external_id: 'LAB-001',
    code: 'SYN-001',
    description: 'Synthetic maintenance operation',
    standard_aw: '1,5',
    hourly_rate: '85,00',
    internal_cost: '40,00',
    category_name: 'synthetic mechanics',
    fitment_make: 'Synthetic',
    fitment_model: 'Model One',
    fitment_year_from: '2015',
    fitment_year_to: '2020',
    fitment_engine_code: 'SYN-E1',
    ...overrides,
  };
}

describe('Labor operation import (e2e)', () => {
  const suite = setupImportE2eSuite('aut815-labor');
  const {
    dryRun,
    applyJob,
    applyWithTotals,
    rowsOf,
    mappings,
    audits,
    errorsCsv,
    expectHidden,
    expectForbidden,
    expectUnapplied,
  } = createImportTestClient(suite, {
    entityType: 'LABOR_OPERATION',
    sourceSystem: SOURCE,
    headers: HEADERS,
    auditEntityTypes: ['LaborOperation'],
  });
  let categoryId: string;
  let otherCategoryId: string;

  beforeEach(async () => {
    for (const t of [suite.tenant, suite.otherTenant]) {
      await createTenantAwarePrisma(suite.basePrisma, t.tenantId).importSource.create({
        data: { tenant_id: t.tenantId, key: SOURCE, label: 'Synthetic Import' },
      });
    }
    const category = await suite.prisma.laborCategory.create({
      data: { tenant_id: suite.tenant.tenantId, name: 'Synthetic Mechanics' },
    });
    categoryId = category.id;
    const otherCategory = await createTenantAwarePrisma(
      suite.basePrisma,
      suite.otherTenant.tenantId,
    ).laborCategory.create({
      data: {
        tenant_id: suite.otherTenant.tenantId,
        name: 'Synthetic Mechanics',
      },
    });
    otherCategoryId = otherCategory.id;
  });

  function operationById(id: string) {
    return suite.prisma.laborOperation.findFirstOrThrow({
      where: { tenant_id: suite.tenant.tenantId, id },
      include: { fitments: true },
    });
  }

  it('previews mixed rows without writes, then applies only valid labor with category, fitment and audit', async () => {
    const csv = Buffer.from(
      [
        HEADERS.join(';'),
        'LAB-001;SYN-001;Synthetic maintenance operation;1,5;85,00;40,00;synthetic mechanics;Synthetic;Model One;2015;2020;SYN-E1',
        'LAB-BAD-AW;SYN-BAD-AW;Synthetic invalid operation;-1;85;40;synthetic mechanics;Synthetic;Model One;2015;2020;SYN-E1',
        'LAB-BAD-FITMENT;SYN-BAD-FITMENT;Synthetic invalid fitment;1,5;85;40;synthetic mechanics;Synthetic;;2015;2020;SYN-E1',
      ].join('\n'),
      'utf8',
    );
    const job = await dryRun(csv);
    expect(job.totals).toMatchObject({
      rows: 3,
      create: 1,
      update: 0,
      skip: 0,
      error: 2,
    });
    const rows = await rowsOf(job.id);
    expect(rows.map((row) => row.action)).toEqual(['CREATE', 'ERROR', 'ERROR']);
    expect(rows[0].normalized).toMatchObject({
      standard_aw: 1.5,
      hourly_rate: 85,
      internal_cost: 40,
      category_id: categoryId,
      fitment: {
        make: 'Synthetic',
        model: 'Model One',
        year_from: 2015,
        year_to: 2020,
        engine_code: 'SYN-E1',
      },
    });
    expect(rows[1].errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'IMPORT_INVALID_STANDARD_AW' }),
      ]),
    );
    expect(rows[2].errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'IMPORT_LABOR_FITMENT_MAKE_MODEL_REQUIRED',
        }),
      ]),
    );
    expect(
      await suite.prisma.laborOperation.count({
        where: { tenant_id: suite.tenant.tenantId },
      }),
    ).toBe(0);
    await expectUnapplied(job.id);

    const download = await errorsCsv(job.id);
    expect(download).toContain('LAB-BAD-AW');
    expect(download).toContain('LAB-BAD-FITMENT');

    const applied = await applyJob(job.id);
    expect(applied.totals).toMatchObject({
      rows: 3,
      create: 1,
      update: 0,
      skip: 0,
      error: 2,
    });
    const operations = await suite.prisma.laborOperation.findMany({
      where: { tenant_id: suite.tenant.tenantId },
      include: { fitments: true },
    });
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      code: 'SYN-001',
      category_id: categoryId,
      is_active: true,
    });
    expect(Number(operations[0].standard_aw)).toBe(1.5);
    expect(Number(operations[0].hourly_rate)).toBe(85);
    expect(Number(operations[0].internal_cost)).toBe(40);
    expect(operations[0].fitments).toEqual([
      expect.objectContaining({
        make: 'Synthetic',
        model: 'Model One',
        year_from: 2015,
        year_to: 2020,
        engine_code: 'SYN-E1',
      }),
    ]);
    expect(await mappings()).toEqual([
      expect.objectContaining({
        external_id: 'LAB-001',
        entity_id: operations[0].id,
        first_seen_import_job_id: job.id,
      }),
    ]);
    const logs = await audits(job.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      entity_id: operations[0].id,
      action: 'CREATE',
      source: 'import',
      actor_user_id: job.created_by,
      actor_email: suite.tenant.email,
      actor_role: 'ADMIN',
      actor_type: 'USER',
      before: null,
      after: { importJobId: job.id, code: 'SYN-001', category_id: categoryId },
    });
    expect(logs[0].diff).toBeNull();
  });

  it('re-imports identical CSV as SKIP without duplicate entities, mappings, fitments or entity audits', async () => {
    const csvRows = [laborRow()];
    const initial = await dryRun(csvRows);
    await applyJob(initial.id);
    const originalMappings = await mappings();
    const operation = await operationById(originalMappings[0].entity_id);

    const replay = await dryRun(csvRows, { update_existing: true });
    expect((await rowsOf(replay.id))[0]).toMatchObject({
      action: 'SKIP',
      entity_id: operation.id,
    });
    await applyWithTotals(replay, {
      rows: 1,
      create: 0,
      update: 0,
      skip: 1,
      error: 0,
    });
    expect(await mappings()).toEqual(originalMappings);
    expect(
      await suite.prisma.laborOperation.count({
        where: { tenant_id: suite.tenant.tenantId },
      }),
    ).toBe(1);
    expect(await operationById(operation.id)).toEqual(operation);
    expect(await audits(replay.id)).toHaveLength(0);
  });

  it('skips changed rows by default and updates existing scalars and fitment only with update_existing', async () => {
    const initial = await dryRun([laborRow()]);
    await applyJob(initial.id);
    const [mapping] = await mappings();
    const changed = laborRow({
      description: 'Adjusted synthetic operation',
      standard_aw: '2,5',
      hourly_rate: '95,00',
      internal_cost: '45,00',
      fitment_year_to: '2024',
      fitment_engine_code: 'SYN-E2',
    });
    const skipped = await dryRun([changed]);
    await applyWithTotals(skipped, { create: 0, update: 0, skip: 1, error: 0 });
    expect(await audits(skipped.id)).toHaveLength(0);
    expect(await operationById(mapping.entity_id)).toMatchObject({
      description: 'Synthetic maintenance operation',
    });

    const update = await dryRun([changed], { update_existing: true });
    expect((await rowsOf(update.id))[0]).toMatchObject({
      action: 'UPDATE',
      entity_id: mapping.entity_id,
    });
    await applyWithTotals(update, { create: 0, update: 1, skip: 0, error: 0 });
    const operation = await operationById(mapping.entity_id);
    expect(operation.description).toBe('Adjusted synthetic operation');
    expect(Number(operation.standard_aw)).toBe(2.5);
    expect(Number(operation.hourly_rate)).toBe(95);
    expect(Number(operation.internal_cost)).toBe(45);
    expect(operation.fitments).toEqual([
      expect.objectContaining({
        year_from: 2015,
        year_to: 2024,
        engine_code: 'SYN-E2',
      }),
    ]);
    expect(await mappings()).toEqual([mapping]);
    const logs = await audits(update.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      entity_id: mapping.entity_id,
      action: 'UPDATE',
      actor_user_id: update.created_by,
      before: { description: 'Synthetic maintenance operation' },
      after: {
        importJobId: update.id,
        description: 'Adjusted synthetic operation',
      },
    });
    expect(logs[0].diff).toBeTruthy();
  });

  it('fills empty cost, category and fitment fields while preserving populated values including zero', async () => {
    const initial = await dryRun([
      laborRow({
        standard_aw: '0',
        hourly_rate: '0',
        internal_cost: '',
        category_name: '',
        fitment_year_from: '',
        fitment_year_to: '2020',
        fitment_engine_code: '',
      }),
    ]);
    await applyJob(initial.id);
    const [mapping] = await mappings();
    const incoming = [
      laborRow({ description: 'Do not overwrite', fitment_year_to: '2024' }),
    ];
    const options = { update_existing: true, fill_empty_only: true };
    const fill = await dryRun(incoming, options);
    await applyWithTotals(fill, { create: 0, update: 1, skip: 0, error: 0 });
    const operation = await operationById(mapping.entity_id);
    expect(operation).toMatchObject({
      description: 'Synthetic maintenance operation',
      category_id: categoryId,
    });
    expect(Number(operation.standard_aw)).toBe(0);
    expect(Number(operation.hourly_rate)).toBe(0);
    expect(Number(operation.internal_cost)).toBe(40);
    expect(operation.fitments).toEqual([
      expect.objectContaining({
        year_from: 2015,
        year_to: 2020,
        engine_code: 'SYN-E1',
      }),
    ]);
    expect(await audits(fill.id)).toEqual([
      expect.objectContaining({
        action: 'UPDATE',
        entity_id: operation.id,
        after: expect.objectContaining({
          importJobId: fill.id,
          category_id: categoryId,
        }),
      }),
    ]);
    const replay = await dryRun(incoming, options);
    expect(replay.totals).toMatchObject({
      create: 0,
      update: 0,
      skip: 1,
      error: 0,
    });
    await applyJob(replay.id);
    expect(await audits(replay.id)).toHaveLength(0);
  });

  it('does not resolve unknown, inactive or another tenant categories', async () => {
    await suite.prisma.laborCategory.create({
      data: {
        tenant_id: suite.tenant.tenantId,
        name: 'Inactive Synthetic',
        is_active: false,
      },
    });
    await createTenantAwarePrisma(
      suite.basePrisma,
      suite.otherTenant.tenantId,
    ).laborCategory.create({
      data: { tenant_id: suite.otherTenant.tenantId, name: 'Other Synthetic' },
    });
    const job = await dryRun([
      laborRow({ category_name: 'Missing Synthetic' }),
      laborRow({
        external_id: 'LAB-002',
        code: 'SYN-002',
        category_name: 'Inactive Synthetic',
      }),
      laborRow({
        external_id: 'LAB-003',
        code: 'SYN-003',
        category_name: 'Other Synthetic',
      }),
    ]);
    expect(job.totals).toMatchObject({ create: 3, error: 0 });
    for (const row of await rowsOf(job.id)) {
      expect(row).toMatchObject({
        action: 'CREATE',
        normalized: { category_id: null },
      });
      expect(row.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'LABOR_CATEGORY_UNKNOWN' }),
        ]),
      );
    }
    await applyJob(job.id);
    expect(
      await suite.prisma.laborOperation.findMany({
        where: { tenant_id: suite.tenant.tenantId },
        select: { category_id: true },
      }),
    ).toEqual([
      { category_id: null },
      { category_id: null },
      { category_id: null },
    ]);
  });

  it('isolates jobs, codes, mappings and categories between tenants with the same external id', async () => {
    const job = await dryRun([laborRow()]);
    await expectHidden(job.id, suite.otherToken);
    await expectUnapplied(job.id);
    await applyJob(job.id);
    const [original] = await mappings();

    const otherJob = await dryRun(
      [laborRow({ description: 'Other synthetic operation' })],
      { update_existing: true },
      suite.otherToken,
    );
    expect(otherJob.totals).toMatchObject({
      create: 1,
      update: 0,
      skip: 0,
      error: 0,
    });
    await applyJob(otherJob.id, suite.otherToken);
    const otherPrisma = createTenantAwarePrisma(
      suite.basePrisma,
      suite.otherTenant.tenantId,
    );
    const otherMapping = await otherPrisma.externalIdMapping.findFirstOrThrow({
      where: {
        tenant_id: suite.otherTenant.tenantId,
        entity_type: 'LABOR_OPERATION',
        source_system: SOURCE,
        external_id: 'LAB-001',
      },
    });
    expect(otherMapping.entity_id).not.toBe(original.entity_id);
    expect(
      await otherPrisma.laborOperation.findFirstOrThrow({
        where: {
          tenant_id: suite.otherTenant.tenantId,
          id: otherMapping.entity_id,
        },
      }),
    ).toMatchObject({
      category_id: otherCategoryId,
      description: 'Other synthetic operation',
    });
    expect(await operationById(original.entity_id)).toMatchObject({
      category_id: categoryId,
      description: 'Synthetic maintenance operation',
    });
    expect(await mappings()).toEqual([original]);
  });

  it.each(['SALES', 'TECH'] as const)(
    'denies %s upload and apply within the owning tenant',
    async (role) => {
      const job = await dryRun([laborRow()]);
      await expectForbidden(job.id, [laborRow()], role);
      expect(
        await suite.prisma.importJob.count({
          where: { tenant_id: suite.tenant.tenantId },
        }),
      ).toBe(1);
      await expectUnapplied(job.id);
      expect(
        await suite.prisma.laborOperation.count({
          where: { tenant_id: suite.tenant.tenantId },
        }),
      ).toBe(0);
    },
  );
});
