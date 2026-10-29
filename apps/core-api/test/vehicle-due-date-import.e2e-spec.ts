import { serializeCsv } from '../src/import/csv-parse.util.js';
import {
  createImportTestClient,
  setupImportE2eSuite,
} from './helpers/import-e2e-suite.js';
import { createTenantAwarePrisma } from './tenant-test-utils.js';

const SOURCE = 'synthetic-import';
const HEADERS = [
  'external_id',
  'vehicle_external_id',
  'kind',
  'inspected_on',
  'plaketten_valid_until_year',
  'plaketten_valid_until_month',
  'due_date',
  'due_mileage',
  'external_ref',
  'station_name',
  'notes',
];
const VEHICLE_HEADERS = ['external_id', 'vin', 'make', 'model', 'year'];
const VEHICLE_CSV = Buffer.from(
  serializeCsv(
    VEHICLE_HEADERS,
    [['VEHICLE-001', 'ZZZ00000000000815', 'Synthetic', 'Model One', '2020']],
    ';',
  ),
  'utf8',
);

function serviceRow(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    external_id: 'DUE-SERVICE',
    vehicle_external_id: 'VEHICLE-001',
    kind: 'SERVICE',
    inspected_on: '',
    plaketten_valid_until_year: '',
    plaketten_valid_until_month: '',
    due_date: '2099-01-15',
    due_mileage: '60000',
    external_ref: 'SYN-SCHEDULE',
    station_name: '',
    notes: 'Synthetic service schedule',
    ...overrides,
  };
}

function inspectionRow(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    external_id: 'DUE-INSPECTION',
    vehicle_external_id: 'VEHICLE-001',
    kind: 'INSPECTION_57A',
    inspected_on: '2020-06-15',
    plaketten_valid_until_year: '2021',
    plaketten_valid_until_month: '6',
    due_date: '',
    due_mileage: '',
    external_ref: 'SYN-REPORT',
    station_name: 'Synthetic inspection station',
    notes: 'Synthetic inspection evidence',
    ...overrides,
  };
}

describe('Vehicle due date import (e2e)', () => {
  const suite = setupImportE2eSuite('aut815-due');
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
    entityType: 'VEHICLE_DUE_DATE',
    sourceSystem: SOURCE,
    headers: HEADERS,
    auditEntityTypes: ['VehicleInspectionRecord', 'VehicleNotice'],
  });
  const vehicles = createImportTestClient(suite, {
    entityType: 'VEHICLE',
    sourceSystem: SOURCE,
    headers: VEHICLE_HEADERS,
    auditEntityTypes: ['Vehicle'],
  });
  let vehicleId: string;

  beforeEach(async () => {
    vehicleId = await importVehicle(suite.tenant, suite.token);
  });

  async function importVehicle(
    targetTenant: typeof suite.tenant,
    bearer: string,
  ): Promise<string> {
    const job = await vehicles.dryRun(VEHICLE_CSV, {}, bearer);
    expect(job.totals).toMatchObject({ create: 1, error: 0 });
    expect((await vehicles.applyJob(job.id, bearer)).totals).toMatchObject({
      create: 1,
      error: 0,
    });
    const mapping = await createTenantAwarePrisma(
      suite.basePrisma,
      targetTenant.tenantId,
    ).externalIdMapping.findFirstOrThrow({
      where: {
        tenant_id: targetTenant.tenantId,
        entity_type: 'VEHICLE',
        source_system: SOURCE,
        external_id: 'VEHICLE-001',
      },
    });
    return mapping.entity_id;
  }

  function noticeById(id: string) {
    return suite.prisma.vehicleNotice.findFirstOrThrow({
      where: { tenant_id: suite.tenant.tenantId, id },
    });
  }

  async function expectNoDueRecords(
    client = suite.prisma,
    tenantId = suite.tenant.tenantId,
  ): Promise<void> {
    const counts = await Promise.all([
      client.vehicleNotice.count({ where: { tenant_id: tenantId } }),
      client.vehicleInspectionRecord.count({ where: { tenant_id: tenantId } }),
    ]);
    expect(counts).toEqual([0, 0]);
  }

  it('previews without writes and applies valid inspection and service rows to an imported vehicle without orphans', async () => {
    const job = await dryRun([
      inspectionRow(),
      serviceRow(),
      serviceRow({
        external_id: 'DUE-UNKNOWN-SERVICE',
        vehicle_external_id: 'VEHICLE-MISSING',
        external_ref: 'SYN-MISSING-SERVICE',
      }),
      inspectionRow({
        external_id: 'DUE-UNKNOWN-INSPECTION',
        vehicle_external_id: 'VEHICLE-MISSING',
        external_ref: 'SYN-MISSING-REPORT',
      }),
      serviceRow({
        external_id: 'DUE-BAD-DATE',
        due_date: '2099-02-30',
        external_ref: 'SYN-BAD-DATE',
      }),
    ]);
    expect(job.totals).toMatchObject({
      rows: 5,
      create: 2,
      update: 0,
      skip: 0,
      error: 3,
    });
    const rows = await rowsOf(job.id);
    expect(rows.map((row) => row.action)).toEqual([
      'CREATE',
      'CREATE',
      'ERROR',
      'ERROR',
      'ERROR',
    ]);
    expect(rows[0].normalized).toMatchObject({
      vehicle_id: vehicleId,
      kind: 'INSPECTION_57A',
      plaketten_valid_until_year: 2021,
      plaketten_valid_until_month: 6,
    });
    expect(rows[1].normalized).toMatchObject({
      vehicle_id: vehicleId,
      kind: 'SERVICE',
      due_date: '2099-01-15',
      due_mileage: 60000,
    });
    for (const row of rows.slice(2, 4)) {
      expect(row.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'IMPORT_UNKNOWN_VEHICLE' }),
        ]),
      );
    }
    expect(rows[4].errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'IMPORT_VALUE_INVALID' }),
      ]),
    );
    await expectNoDueRecords();
    await expectUnapplied(job.id);

    const download = await errorsCsv(job.id);
    expect(download).toContain('DUE-UNKNOWN-SERVICE');
    expect(download).toContain('DUE-UNKNOWN-INSPECTION');
    expect(download).toContain('DUE-BAD-DATE');

    expect((await applyJob(job.id)).totals).toMatchObject({
      rows: 5,
      create: 2,
      update: 0,
      skip: 0,
      error: 3,
    });
    const inspections = await suite.prisma.vehicleInspectionRecord.findMany({
      where: { tenant_id: suite.tenant.tenantId },
    });
    const notices = await suite.prisma.vehicleNotice.findMany({
      where: { tenant_id: suite.tenant.tenantId },
    });
    expect(inspections).toHaveLength(1);
    expect(inspections[0]).toMatchObject({
      vehicle_id: vehicleId,
      inspection_type: 'PICKERL_57A',
      source: 'LEGACY_IMPORT',
      plaketten_valid_until_year: 2021,
      plaketten_valid_until_month: 6,
      station_name: 'Synthetic inspection station',
      notes: 'Synthetic inspection evidence',
      external_inspection_result_id: null,
    });
    expect(inspections[0].inspected_on.toISOString().slice(0, 10)).toBe(
      '2020-06-15',
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      vehicle_id: vehicleId,
      type: 'SERVICE_DUE',
      status: 'OPEN',
      source: 'LEGACY_IMPORT',
      due_mileage: 60000,
      external_ref: 'SYN-SCHEDULE',
      body: 'Synthetic service schedule',
    });
    expect(notices[0].due_date?.toISOString().slice(0, 10)).toBe('2099-01-15');
    expect(await mappings()).toEqual([
      expect.objectContaining({
        external_id: 'DUE-INSPECTION',
        entity_id: inspections[0].id,
        first_seen_import_job_id: job.id,
      }),
      expect.objectContaining({
        external_id: 'DUE-SERVICE',
        entity_id: notices[0].id,
        first_seen_import_job_id: job.id,
      }),
    ]);
    const logs = await audits(job.id);
    expect(logs).toHaveLength(2);
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity_type: 'VehicleInspectionRecord',
          entity_id: inspections[0].id,
          action: 'CREATE',
        }),
        expect.objectContaining({
          entity_type: 'VehicleNotice',
          entity_id: notices[0].id,
          action: 'CREATE',
        }),
      ]),
    );
    for (const log of logs) {
      expect(log).toMatchObject({
        source: 'import',
        actor_user_id: job.created_by,
        actor_email: suite.tenant.email,
        actor_role: 'ADMIN',
        actor_type: 'USER',
        before: null,
        after: { importJobId: job.id, vehicle_id: vehicleId },
      });
      expect(log.diff).toBeNull();
    }
    expect(
      await suite.prisma.vehicle.count({
        where: { tenant_id: suite.tenant.tenantId },
      }),
    ).toBe(1);
  });

  it('re-imports both due date kinds as SKIP through ExternalIdMapping without new records or entity audits', async () => {
    const csvRows = [inspectionRow(), serviceRow()];
    const initial = await dryRun(csvRows);
    await applyJob(initial.id);
    const originalMappings = await mappings();
    const inspection =
      await suite.prisma.vehicleInspectionRecord.findFirstOrThrow({
        where: { tenant_id: suite.tenant.tenantId, vehicle_id: vehicleId },
      });
    const notice = await noticeById(originalMappings[1].entity_id);

    const replay = await dryRun(csvRows, { update_existing: true });
    expect(await rowsOf(replay.id)).toEqual([
      expect.objectContaining({ action: 'SKIP', entity_id: inspection.id }),
      expect.objectContaining({ action: 'SKIP', entity_id: notice.id }),
    ]);
    await applyWithTotals(replay, {
      rows: 2,
      create: 0,
      update: 0,
      skip: 2,
      error: 0,
    });
    expect(await mappings()).toEqual(originalMappings);
    expect(
      await suite.prisma.vehicleInspectionRecord.findMany({
        where: { tenant_id: suite.tenant.tenantId },
      }),
    ).toEqual([inspection]);
    expect(
      await suite.prisma.vehicleNotice.findMany({
        where: { tenant_id: suite.tenant.tenantId },
      }),
    ).toEqual([notice]);
    expect(await audits(replay.id)).toHaveLength(0);
  });

  it('skips changed service rows by default and updates an OPEN notice only with update_existing', async () => {
    const initial = await dryRun([serviceRow()]);
    await applyJob(initial.id);
    const [mapping] = await mappings();
    const changed = serviceRow({
      due_date: '2099-02-15',
      due_mileage: '63000',
      notes: 'Adjusted synthetic schedule',
    });
    const skipped = await dryRun([changed]);
    expect((await rowsOf(skipped.id))[0].warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'IMPORT_UPDATE_NOT_ENABLED' }),
      ]),
    );
    await applyWithTotals(skipped, { create: 0, update: 0, skip: 1, error: 0 });
    expect(await audits(skipped.id)).toHaveLength(0);
    expect(await noticeById(mapping.entity_id)).toMatchObject({
      due_mileage: 60000,
      body: 'Synthetic service schedule',
    });

    const update = await dryRun([changed], { update_existing: true });
    expect((await rowsOf(update.id))[0]).toMatchObject({
      action: 'UPDATE',
      entity_id: mapping.entity_id,
    });
    await applyWithTotals(update, { create: 0, update: 1, skip: 0, error: 0 });
    const notice = await noticeById(mapping.entity_id);
    expect(notice).toMatchObject({
      status: 'OPEN',
      due_mileage: 63000,
      body: 'Adjusted synthetic schedule',
      vehicle_id: vehicleId,
    });
    expect(notice.due_date?.toISOString().slice(0, 10)).toBe('2099-02-15');
    expect(await mappings()).toEqual([mapping]);
    const logs = await audits(update.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      entity_type: 'VehicleNotice',
      entity_id: notice.id,
      action: 'UPDATE',
      actor_user_id: update.created_by,
      before: {
        due_date: '2099-01-15',
        due_mileage: 60000,
        body: 'Synthetic service schedule',
      },
      after: {
        importJobId: update.id,
        due_date: '2099-02-15',
        due_mileage: 63000,
        body: 'Adjusted synthetic schedule',
      },
    });
    expect(logs[0].diff).toEqual({
      due_date: { before: '2099-01-15', after: '2099-02-15' },
      due_mileage: { before: 60000, after: 63000 },
      body: {
        before: 'Synthetic service schedule',
        after: 'Adjusted synthetic schedule',
      },
    });
  });

  it.each([
    {
      name: 'mileage and notes',
      initial: { due_date: '2099-01-15', due_mileage: '', notes: '' },
      incoming: {
        due_date: '2099-02-15',
        due_mileage: '0',
        notes: 'Filled synthetic schedule',
      },
      expectedDate: '2099-01-15',
      expectedBody: 'Filled synthetic schedule',
      before: { due_date: '2099-01-15', due_mileage: null, body: null },
      after: { due_mileage: 0, body: 'Filled synthetic schedule' },
      diff: {
        due_mileage: { before: null, after: 0 },
        body: { before: null, after: 'Filled synthetic schedule' },
      },
    },
    {
      name: 'date',
      initial: {
        due_date: '',
        due_mileage: '0',
        notes: 'Synthetic service schedule',
      },
      incoming: {
        due_date: '2099-02-15',
        due_mileage: '70000',
        notes: 'Do not overwrite',
      },
      expectedDate: '2099-02-15',
      expectedBody: 'Synthetic service schedule',
      before: {
        due_date: null,
        due_mileage: 0,
        body: 'Synthetic service schedule',
      },
      after: { due_date: '2099-02-15' },
      diff: { due_date: { before: null, after: '2099-02-15' } },
    },
  ])(
    'fills empty service $name and preserves populated values including zero',
    async (scenario) => {
      const initial = await dryRun([serviceRow(scenario.initial)]);
      await applyWithTotals(initial, {
        create: 1,
        update: 0,
        skip: 0,
        error: 0,
      });
      const [mapping] = await mappings();
      const options = { update_existing: true, fill_empty_only: true };
      const incoming = serviceRow(scenario.incoming);
      const fill = await dryRun([incoming], options);
      await applyWithTotals(fill, { create: 0, update: 1, skip: 0, error: 0 });
      const notice = await noticeById(mapping.entity_id);
      expect(notice).toMatchObject({
        due_mileage: 0,
        body: scenario.expectedBody,
      });
      expect(notice.due_date?.toISOString().slice(0, 10)).toBe(
        scenario.expectedDate,
      );
      expect(await audits(fill.id)).toEqual([
        expect.objectContaining({
          action: 'UPDATE',
          entity_id: notice.id,
          before: scenario.before,
          after: { importJobId: fill.id, ...scenario.after },
          diff: scenario.diff,
        }),
      ]);
      const replay = await dryRun([incoming], options);
      await applyWithTotals(replay, {
        create: 0,
        update: 0,
        skip: 1,
        error: 0,
      });
      expect(await audits(replay.id)).toHaveLength(0);
      const preserved = await dryRun(
        [
          serviceRow({
            due_date: '2099-03-15',
            due_mileage: '70000',
            notes: 'Do not overwrite',
          }),
        ],
        options,
      );
      await applyWithTotals(preserved, {
        create: 0,
        update: 0,
        skip: 1,
        error: 0,
      });
      expect(await audits(preserved.id)).toHaveLength(0);
      expect(await noticeById(notice.id)).toEqual(notice);
      expect(await mappings()).toEqual([mapping]);
    },
  );

  it('isolates jobs and vehicle resolution, then imports the same external ids independently in another tenant', async () => {
    const job = await dryRun([serviceRow()]);
    await expectHidden(job.id, suite.otherToken);
    await expectUnapplied(job.id);
    await applyJob(job.id);
    const [original] = await mappings();
    const otherPrisma = createTenantAwarePrisma(
      suite.basePrisma,
      suite.otherTenant.tenantId,
    );
    const unknown = await dryRun(
      [serviceRow(), inspectionRow()],
      {},
      suite.otherToken,
    );
    expect(unknown.totals).toMatchObject({
      create: 0,
      update: 0,
      skip: 0,
      error: 2,
    });
    for (const row of await rowsOf(unknown.id, suite.otherToken)) {
      expect(row).toMatchObject({ action: 'ERROR' });
      expect(row.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'IMPORT_UNKNOWN_VEHICLE' }),
        ]),
      );
    }
    expect((await applyJob(unknown.id, suite.otherToken)).totals).toMatchObject(
      {
        create: 0,
        error: 2,
      },
    );
    await expectNoDueRecords(otherPrisma, suite.otherTenant.tenantId);
    expect(
      await otherPrisma.externalIdMapping.count({
        where: { tenant_id: suite.otherTenant.tenantId },
      }),
    ).toBe(0);
    expect(
      await otherPrisma.auditLog.count({
        where: {
          tenant_id: suite.otherTenant.tenantId,
          source: 'import',
          entity_type: { in: ['VehicleInspectionRecord', 'VehicleNotice'] },
        },
      }),
    ).toBe(0);

    const otherVehicleId = await importVehicle(
      suite.otherTenant,
      suite.otherToken,
    );
    expect(otherVehicleId).not.toBe(vehicleId);
    const otherJob = await dryRun(
      [serviceRow({ notes: 'Other synthetic schedule' })],
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
    const otherMapping = await otherPrisma.externalIdMapping.findFirstOrThrow({
      where: {
        tenant_id: suite.otherTenant.tenantId,
        entity_type: 'VEHICLE_DUE_DATE',
        source_system: SOURCE,
        external_id: 'DUE-SERVICE',
      },
    });
    expect(otherMapping.entity_id).not.toBe(original.entity_id);
    expect(
      await otherPrisma.vehicleNotice.findFirstOrThrow({
        where: {
          tenant_id: suite.otherTenant.tenantId,
          id: otherMapping.entity_id,
        },
      }),
    ).toMatchObject({
      vehicle_id: otherVehicleId,
      body: 'Other synthetic schedule',
    });
    expect(await noticeById(original.entity_id)).toMatchObject({
      vehicle_id: vehicleId,
      body: 'Synthetic service schedule',
    });
    expect(await mappings()).toEqual([original]);
  });

  it.each(['SALES', 'TECH'] as const)(
    'denies %s upload and apply within the owning tenant',
    async (role) => {
      const job = await dryRun([serviceRow()]);
      await expectForbidden(job.id, [serviceRow()], role);
      expect(
        await suite.prisma.importJob.count({
          where: {
            tenant_id: suite.tenant.tenantId,
            entity_type: 'VEHICLE_DUE_DATE',
          },
        }),
      ).toBe(1);
      await expectUnapplied(job.id);
      await expectNoDueRecords();
    },
  );
});
