import { ImportEntityType, ImportRowAction } from '@prisma/client';
import { parseCsvFile, rowToRecord, serializeCsv } from './csv-parse.util.js';
import { planCustomerDryRun } from './customer-import.dry-run.js';
import { planVehiclePartyDryRun } from './vehicle-party-import.dry-run.js';
import { planVehicleDryRun } from './vehicle-import.dry-run.js';
import { planLaborOperationDryRun } from './labor-operation-import.dry-run.js';
import { planSupplierPriceListRows } from './supplier-price-list-import.dry-run.js';
import { planVehicleDueDateDryRun } from './vehicle-due-date-import.dry-run.js';
import { toParsedCsvFromRecords } from './import-dry-run-reconcile.records.js';
import type { DryRunRowResult } from './import.types.js';
import type { ParsedCsv } from './csv-parse.util.js';
import type { ImportDryRunInput } from './import-type-handler.js';
import type { ImportDryRunReconcileUnit } from './import-job.worker-state.js';

const BATCH = 3;
const RECONCILE_BATCH = 2;

function signatures(rows: DryRunRowResult[]) {
  return rows.map((row) => ({
    row_no: row.row_no,
    action: row.action,
    codes: row.errors.map((issue) => issue.code),
    messages: row.errors.map((issue) => issue.message),
  }));
}

async function planBatched(
  plan: (
    input: ImportDryRunInput,
    parsed: ParsedCsv,
  ) => Promise<DryRunRowResult[]>,
  input: ImportDryRunInput,
  parsed: ParsedCsv,
): Promise<DryRunRowResult[]> {
  const merged: DryRunRowResult[] = [];
  for (let offset = 0; offset < parsed.rows.length; offset += BATCH) {
    const slice: ParsedCsv = {
      headers: parsed.headers,
      rows: parsed.rows.slice(offset, offset + BATCH),
      delimiter: parsed.delimiter,
      sha256: parsed.sha256,
    };
    merged.push(
      ...(await plan(
        {
          ...input,
          planBudget: {
            deadlineMs: Date.now() + 60_000,
            rowNoOffset: offset + 1,
          },
        },
        slice,
      )),
    );
  }
  return merged;
}

async function replanWindows(
  plan: (
    input: ImportDryRunInput,
    parsed: ParsedCsv,
  ) => Promise<DryRunRowResult[]>,
  input: ImportDryRunInput,
  parsed: ParsedCsv,
  unit: ImportDryRunReconcileUnit,
  target: DryRunRowResult[],
  reconcileBatchSize = RECONCILE_BATCH,
) {
  const unitSet = new Set(unit.replan_row_nos);
  let targetIndex = 0;
  while (targetIndex < unit.replan_row_nos.length) {
    const targets: number[] = [];
    let selectionEnd = targetIndex;
    while (
      selectionEnd < unit.replan_row_nos.length &&
      targets.length < reconcileBatchSize
    ) {
      targets.push(unit.replan_row_nos[selectionEnd]);
      selectionEnd += 1;
    }
    if (targets.length === 0) {
      break;
    }
    const priorResults = unit.replan_row_nos
      .slice(0, targetIndex)
      .map((rowNo) => target[rowNo - 1]);
    const records = targets.map((rowNo) => ({
      rowNo,
      record: rowToRecord(parsed.headers, parsed.rows[rowNo - 1]),
    }));
    const sparse = toParsedCsvFromRecords(
      parsed.headers,
      records,
      parsed.sha256 ?? 'test-sha',
    );
    const replanned = await plan(
      {
        ...input,
        reconcilePriorResults: priorResults,
        planBudget: {
          deadlineMs: Date.now() + 60_000,
          rowNoOffset: targets[0],
          rowNumbers: targets,
        },
      },
      sparse,
    );
    for (const row of replanned.filter((item) => unitSet.has(item.row_no))) {
      const index = target.findIndex((item) => item.row_no === row.row_no);
      if (index >= 0) {
        target[index] = row;
      }
    }
    const plannedSet = new Set(replanned.map((row) => row.row_no));
    let nextIndex = targetIndex;
    for (let cursor = targetIndex; cursor < selectionEnd; cursor += 1) {
      const rowNo = unit.replan_row_nos[cursor];
      if (!plannedSet.has(rowNo)) {
        break;
      }
      nextIndex = cursor + 1;
    }
    if (nextIndex === targetIndex) {
      break;
    }
    targetIndex = nextIndex;
  }
}

type ParityTestPrisma = {
  externalIdMapping: { findMany: jest.Mock };
  customer: { findMany: jest.Mock };
  vehicle: { findMany: jest.Mock };
  vehicleParty: { findMany: jest.Mock };
  laborOperation: { findMany: jest.Mock };
  laborCategory: { findMany: jest.Mock };
  marginRule: { findMany: jest.Mock };
  brand: { findMany: jest.Mock };
  financeSettings: { findFirst: jest.Mock };
  catalogItem: { findMany: jest.Mock };
  vendorArticle: { findMany: jest.Mock };
  vehicleInspectionRecord: { findMany: jest.Mock };
  vehicleNotice: { findMany: jest.Mock };
};

function emptyParityPrisma(): ParityTestPrisma {
  return {
    externalIdMapping: { findMany: jest.fn().mockResolvedValue([]) },
    customer: { findMany: jest.fn().mockResolvedValue([]) },
    vehicle: { findMany: jest.fn().mockResolvedValue([]) },
    vehicleParty: { findMany: jest.fn().mockResolvedValue([]) },
    laborOperation: { findMany: jest.fn().mockResolvedValue([]) },
    laborCategory: { findMany: jest.fn().mockResolvedValue([]) },
    marginRule: { findMany: jest.fn().mockResolvedValue([]) },
    brand: { findMany: jest.fn().mockResolvedValue([]) },
    financeSettings: { findFirst: jest.fn().mockResolvedValue(null) },
    catalogItem: { findMany: jest.fn().mockResolvedValue([]) },
    vendorArticle: { findMany: jest.fn().mockResolvedValue([]) },
    vehicleInspectionRecord: { findMany: jest.fn().mockResolvedValue([]) },
    vehicleNotice: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('dry-run reconcile parity (sync vs batched + range replan)', () => {
  let prisma: ParityTestPrisma;

  beforeEach(() => {
    prisma = emptyParityPrisma();
  });

  it('customer duplicate email across batches matches sync after replanning the spanning range', async () => {
    const mapping = {
      external_id: 'id',
      type: 'type',
      first_name: 'first',
      last_name: 'last',
      email: 'email',
      phone: 'phone',
      vat_id: 'vat',
      address_country: 'country',
    };
    const parsed = parseCsvFile(
      Buffer.from(
        serializeCsv(
        Object.values(mapping),
        [
          ['c1', 'PRIVATE', 'A', 'One', 'dup@example.com', '', '', 'AT'],
          ['c2', 'PRIVATE', 'B', 'Two', '', '', '', 'AT'],
          ['c3', 'PRIVATE', 'C', 'Three', '', '', '', 'AT'],
          ['c4', 'PRIVATE', 'D', 'Four', 'dup@example.com', '', '', 'AT'],
        ],
        ),
        'utf8',
      ),
    );
    const input = {
      tenantId: 'tenant-1',
      sourceSystem: 'legacy',
      mapping,
      options: {},
    };
    const plan = (dryRunInput: ImportDryRunInput, slice: ParsedCsv) =>
      planCustomerDryRun(prisma as never, dryRunInput, slice);
    const sync = await plan(input, parsed);
    const batched = await planBatched(plan, input, parsed);
    expect(batched[3].action).toBe(ImportRowAction.CREATE);
    await replanWindows(plan, input, parsed, {
      context_from_row: 1,
      context_to_row: 4,
      replan_row_nos: [1, 4],
    }, batched);
    expect(signatures(batched)).toEqual(signatures(sync));
  });

  it('vehicle party duplicate external_id across batches matches sync after replanning', async () => {
    prisma.externalIdMapping.findMany = jest.fn().mockResolvedValue([
      {
        entity_type: ImportEntityType.VEHICLE,
        external_id: 'VEH-1',
        entity_id: 'veh-1',
      },
      {
        entity_type: ImportEntityType.CUSTOMER,
        external_id: 'CUST-1',
        entity_id: 'cust-1',
      },
    ]);
    const mapping = Object.fromEntries(
      [
        'external_id',
        'vehicle_external_id',
        'customer_external_id',
        'role',
        'valid_from',
        'valid_to',
        'notes',
      ].map((name) => [name, name]),
    );
    const parsed = parseCsvFile(
      Buffer.from(
        serializeCsv(
        Object.values(mapping),
        [
          ['p1', 'VEH-1', 'CUST-1', 'OWNER', '2024-01-01', '', ''],
          ['p2', 'VEH-1', 'CUST-1', 'DRIVER', '2024-01-01', '', ''],
          ['p3', 'VEH-1', 'CUST-1', 'DRIVER', '2024-01-01', '', ''],
          ['dup', 'VEH-1', 'CUST-1', 'DRIVER', '2024-01-01', '', ''],
        ],
        ),
        'utf8',
      ),
    );
    const input = {
      tenantId: 'tenant-1',
      sourceSystem: 'legacy',
      mapping,
      options: { cutover_date: '2026-11-01' },
    };
    const plan = (dryRunInput: ImportDryRunInput, slice: ParsedCsv) =>
      planVehiclePartyDryRun(prisma as never, dryRunInput, slice);
    const sync = await plan(input, parsed);
    const batched = await planBatched(plan, input, parsed);
    await replanWindows(plan, input, parsed, {
      context_from_row: 1,
      context_to_row: 4,
      replan_row_nos: [1, 2, 3, 4],
    }, batched);
    expect(signatures(batched)).toEqual(signatures(sync));
  });

  it('vehicle duplicate VIN across batches matches sync after sparse replan', async () => {
    const mapping = {
      external_id: 'Fahrzeug-Nr',
      vin: 'FIN',
      plate: 'Kennzeichen',
      make: 'Marke',
      model: 'Modell',
      year: 'Baujahr',
      owner_customer_external_id: 'Kunden-Nr',
    };
    const vin = '1HGCM82633A004352';
    const parsed = parseCsvFile(
      Buffer.from(
        serializeCsv(
          Object.values(mapping),
          [
            ['1', vin, '', 'Make', 'Model', '2020', ''],
            ['2', '', '', 'Make', 'Model', '2020', ''],
            ['3', '', '', 'Make', 'Model', '2020', ''],
            ['4', vin, '', 'Make', 'Model', '2020', ''],
          ],
        ),
        'utf8',
      ),
    );
    const input = {
      tenantId: 'tenant-1',
      sourceSystem: 'legacy',
      mapping,
      options: {},
    };
    const plan = (dryRunInput: ImportDryRunInput, slice: ParsedCsv) =>
      planVehicleDryRun(prisma as never, dryRunInput, slice);
    const sync = await plan(input, parsed);
    const batched = await planBatched(plan, input, parsed);
    await replanWindows(plan, input, parsed, {
      context_from_row: 1,
      context_to_row: 4,
      replan_row_nos: [1, 4],
    }, batched);
    expect(signatures(batched)).toEqual(signatures(sync));
  });

  it('labor duplicate code across batches matches sync after sparse replan', async () => {
    const mapping = {
      external_id: 'Arbeitswert-Nr',
      code: 'AW-Code',
      description: 'Beschreibung',
      standard_aw: 'AW',
      hourly_rate: 'Stundensatz',
    };
    const parsed = parseCsvFile(
      Buffer.from(
        serializeCsv(
          Object.values(mapping),
          [
            ['101', 'AW-100', 'First', '1', '80'],
            ['102', 'AW-200', 'Second', '1', '80'],
            ['103', 'AW-300', 'Third', '1', '80'],
            ['104', 'AW-100', 'Dup', '1', '80'],
          ],
        ),
        'utf8',
      ),
    );
    const input = {
      tenantId: 'tenant-1',
      sourceSystem: 'legacy',
      mapping,
      options: {},
    };
    const plan = (dryRunInput: ImportDryRunInput, slice: ParsedCsv) =>
      planLaborOperationDryRun(prisma as never, dryRunInput, slice);
    const sync = await plan(input, parsed);
    const batched = await planBatched(plan, input, parsed);
    await replanWindows(plan, input, parsed, {
      context_from_row: 1,
      context_to_row: 4,
      replan_row_nos: [1, 4],
    }, batched);
    expect(signatures(batched)).toEqual(signatures(sync));
  });

  it('supplier duplicate article number across batches matches sync after sparse replan', async () => {
    const mapping = {
      supplier_article_no: 'Lieferanten-Artikelnummer',
      ean: 'EAN',
      description: 'Beschreibung',
      brand: 'Marke',
      cost_price: 'Einkaufspreis',
      rrp: 'UVP',
      unit: 'Einheit',
    };
    const parsed = parseCsvFile(
      Buffer.from(
        serializeCsv(
          Object.values(mapping),
          [
            ['ART-1', '', 'One', '', '10,00', '', 'Stk'],
            ['ART-2', '', 'Two', '', '20,00', '', 'Stk'],
            ['ART-3', '', 'Three', '', '30,00', '', 'Stk'],
            ['ART-1', '', 'Dup', '', '40,00', '', 'Stk'],
          ],
        ),
        'utf8',
      ),
    );
    const input = {
      tenantId: 'tenant-1',
      sourceSystem: 'legacy',
      mapping,
      options: { vendor_id: 'vendor-1' },
    };
    const plan = (dryRunInput: ImportDryRunInput, slice: ParsedCsv) =>
      planSupplierPriceListRows(
        prisma as never,
        {
          tenantId: dryRunInput.tenantId,
          vendorId: 'vendor-1',
          mapping: dryRunInput.mapping,
          options: dryRunInput.options,
        },
        slice,
        dryRunInput.planBudget,
      );
    const sync = await plan(input, parsed);
    const batched = await planBatched(plan, input, parsed);
    await replanWindows(plan, input, parsed, {
      context_from_row: 1,
      context_to_row: 4,
      replan_row_nos: [1, 4],
    }, batched);
    expect(signatures(batched)).toEqual(signatures(sync));
  });

  it('vehicle due-date duplicate natural key across batches matches sync after windowed replan', async () => {
    prisma.externalIdMapping = {
      findMany: jest.fn().mockResolvedValue([
        {
          entity_type: ImportEntityType.VEHICLE,
          external_id: 'VEHICLE-001',
          entity_id: 'veh-1',
        },
      ]),
    };
    const mapping = Object.fromEntries(
      [
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
      ].map((name) => [name, name]),
    );
    const dueTail = (
      externalRef: string,
      inspectedOn = '2026-06-15',
    ): string[] => [
      inspectedOn,
      '2027',
      '6',
      '',
      '',
      externalRef,
      '',
      '',
    ];
    const parsed = parseCsvFile(
      Buffer.from(
        serializeCsv(
          Object.values(mapping),
          [
            ['DUE-1', 'VEHICLE-001', 'INSPECTION_57A', ...dueTail('REP-A')],
            ['DUE-2', 'VEHICLE-001', 'INSPECTION_57A', ...dueTail('', '')],
            ['DUE-3', 'VEHICLE-001', 'INSPECTION_57A', ...dueTail('', '')],
            ['DUE-4', 'VEHICLE-001', 'INSPECTION_57A', ...dueTail('REP-B')],
          ],
        ),
        'utf8',
      ),
    );
    const input = {
      tenantId: 'tenant-1',
      sourceSystem: 'legacy',
      mapping,
      options: { cutover_date: '2026-11-01' },
    };
    const plan = (dryRunInput: ImportDryRunInput, slice: ParsedCsv) =>
      planVehicleDueDateDryRun(prisma as never, dryRunInput, slice);
    const sync = await plan(input, parsed);
    const batched = await planBatched(plan, input, parsed);
    await replanWindows(plan, input, parsed, {
      context_from_row: 1,
      context_to_row: 4,
      replan_row_nos: [1, 4],
    }, batched);
    expect(signatures(batched)).toEqual(signatures(sync));
  });

  it('vehicle party overlap group larger than one reconcile window matches sync', async () => {
    prisma.externalIdMapping = {
      findMany: jest.fn().mockResolvedValue([
        {
          entity_type: ImportEntityType.VEHICLE,
          external_id: 'VEHICLE-001',
          entity_id: 'veh-1',
        },
        {
          entity_type: ImportEntityType.CUSTOMER,
          external_id: 'CUSTOMER-A',
          entity_id: 'cust-a',
        },
        {
          entity_type: ImportEntityType.CUSTOMER,
          external_id: 'CUSTOMER-B',
          entity_id: 'cust-b',
        },
      ]),
    };
    const mapping = Object.fromEntries(
      [
        'external_id',
        'vehicle_external_id',
        'customer_external_id',
        'role',
        'valid_from',
        'valid_to',
        'notes',
      ].map((name) => [name, name]),
    );
    const partyRow = (
      rowNo: number,
      customer: string,
      validFrom = '2024-01-01',
    ) => [
      `PARTY-${rowNo}`,
      'VEHICLE-001',
      customer,
      'OWNER',
      validFrom,
      '',
      '',
    ];
    const parsed = parseCsvFile(
      Buffer.from(
        serializeCsv(
          Object.values(mapping),
          [
            partyRow(1, 'CUSTOMER-A'),
            partyRow(2, 'CUSTOMER-B', '2025-01-01'),
            partyRow(3, 'CUSTOMER-A'),
            partyRow(4, 'CUSTOMER-B', '2025-01-01'),
            partyRow(5, 'CUSTOMER-A'),
            partyRow(6, 'CUSTOMER-B', '2025-01-01'),
          ],
        ),
        'utf8',
      ),
    );
    const input = {
      tenantId: 'tenant-1',
      sourceSystem: 'legacy',
      mapping,
      options: { cutover_date: '2026-11-01' },
    };
    const plan = (dryRunInput: ImportDryRunInput, slice: ParsedCsv) =>
      planVehiclePartyDryRun(prisma as never, dryRunInput, slice);
    const sync = await plan(input, parsed);
    const batched = await planBatched(plan, input, parsed);
    await replanWindows(
      plan,
      input,
      parsed,
      {
        context_from_row: 1,
        context_to_row: 6,
        replan_row_nos: [1, 2, 3, 4, 5, 6],
      },
      batched,
      2,
    );
    expect(signatures(batched)).toEqual(signatures(sync));
  });

  it('vehicle due-date overlap group larger than one reconcile window matches sync', async () => {
    prisma.externalIdMapping = {
      findMany: jest.fn().mockResolvedValue([
        {
          entity_type: ImportEntityType.VEHICLE,
          external_id: 'VEHICLE-001',
          entity_id: 'veh-1',
        },
      ]),
    };
    const mapping = Object.fromEntries(
      [
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
      ].map((name) => [name, name]),
    );
    const inspection = (rowNo: number, ref: string) => [
      `DUE-${rowNo}`,
      'VEHICLE-001',
      'INSPECTION_57A',
      '2026-06-15',
      '2027',
      '6',
      '',
      '',
      ref,
      'Station',
      '',
    ];
    const parsed = parseCsvFile(
      Buffer.from(
        serializeCsv(
          Object.values(mapping),
          [
            inspection(1, 'REP-1'),
            inspection(2, 'REP-2'),
            inspection(3, 'REP-3'),
            inspection(4, 'REP-4'),
            inspection(5, 'REP-5'),
            inspection(6, 'REP-6'),
          ],
        ),
        'utf8',
      ),
    );
    const input = {
      tenantId: 'tenant-1',
      sourceSystem: 'legacy',
      mapping,
      options: { cutover_date: '2026-11-01' },
    };
    const plan = (dryRunInput: ImportDryRunInput, slice: ParsedCsv) =>
      planVehicleDueDateDryRun(prisma as never, dryRunInput, slice);
    const sync = await plan(input, parsed);
    const batched = await planBatched(plan, input, parsed);
    await replanWindows(
      plan,
      input,
      parsed,
      {
        context_from_row: 1,
        context_to_row: 6,
        replan_row_nos: [1, 2, 3, 4, 5, 6],
      },
      batched,
      2,
    );
    expect(signatures(batched)).toEqual(signatures(sync));
  });
});
