import { ImportEntityType, ImportRowAction } from '@prisma/client';
import { parseCsvFile, rowToRecord, serializeCsv } from './csv-parse.util.js';
import { planCustomerDryRun } from './customer-import.dry-run.js';
import { planVehiclePartyDryRun } from './vehicle-party-import.dry-run.js';
import { planVehicleDryRun } from './vehicle-import.dry-run.js';
import { planLaborOperationDryRun } from './labor-operation-import.dry-run.js';
import { planSupplierPriceListRows } from './supplier-price-list-import.dry-run.js';
import { toParsedCsvFromRecords } from './import-dry-run-reconcile.records.js';
import type { DryRunRowResult } from './import.types.js';
import type { ParsedCsv } from './csv-parse.util.js';
import type { ImportDryRunInput } from './import-type-handler.js';
import type { ImportDryRunReconcileUnit } from './import-job.worker-state.js';

const BATCH = 3;

function signatures(rows: DryRunRowResult[]) {
  return rows.map((row) => ({
    row_no: row.row_no,
    action: row.action,
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

async function replanUnit(
  plan: (
    input: ImportDryRunInput,
    parsed: ParsedCsv,
  ) => Promise<DryRunRowResult[]>,
  input: ImportDryRunInput,
  parsed: ParsedCsv,
  unit: ImportDryRunReconcileUnit,
  target: DryRunRowResult[],
) {
  const rowNos = [...unit.replan_row_nos].sort((a, b) => a - b);
  const records = rowNos.map((rowNo) => ({
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
      planBudget: {
        deadlineMs: Date.now() + 60_000,
        rowNoOffset: rowNos[0],
        rowNumbers: rowNos,
      },
    },
    sparse,
  );
  for (const row of replanned) {
    const index = target.findIndex((item) => item.row_no === row.row_no);
    if (index >= 0) {
      target[index] = row;
    }
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
    await replanUnit(plan, input, parsed, {
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
    await replanUnit(plan, input, parsed, {
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
    await replanUnit(plan, input, parsed, {
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
    await replanUnit(plan, input, parsed, {
      context_from_row: 1,
      context_to_row: 4,
      replan_row_nos: [1, 4],
    }, batched);
    expect(signatures(batched)).toEqual(signatures(sync));
  });

  it('supplier duplicate external_id across batches matches sync after sparse replan', async () => {
    const mapping = {
      external_id: 'Artikel-Nr',
      article_number: 'Artikel-Nr',
      description: 'Bezeichnung',
      unit_price: 'Preis',
    };
    const parsed = parseCsvFile(
      Buffer.from(
        serializeCsv(
          Object.values(mapping),
          [
            ['sku-1', 'sku-1', 'One', '10'],
            ['sku-2', 'sku-2', 'Two', '20'],
            ['sku-3', 'sku-3', 'Three', '30'],
            ['sku-1', 'sku-1', 'Dup', '40'],
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
    await replanUnit(plan, input, parsed,
      {
        context_from_row: 1,
        context_to_row: 4,
        replan_row_nos: [1, 4],
      },
      batched,
    );
    expect(signatures(batched)).toEqual(signatures(sync));
  });
});
