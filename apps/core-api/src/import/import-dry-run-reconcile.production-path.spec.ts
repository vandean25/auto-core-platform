import { ImportEntityType } from '@prisma/client';
import { serializeCsv, parseCsvFile } from './csv-parse.util.js';
import { planCustomerDryRun } from './customer-import.dry-run.js';
import { planVehiclePartyDryRun } from './vehicle-party-import.dry-run.js';
import { replanImportDryRunUnit } from './import-dry-run-reconcile.plan-unit.js';
import { computeImportDryRunReconcileUnits } from './import-dry-run-reconcile.units.js';
import { IMPORT_RECONCILE_GROUP_MAX_ROWS } from './import-dry-run-group-limit.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import type { ImportDryRunInput } from './import-type-handler.js';
import type { ParsedCsv } from './csv-parse.util.js';
import type { DryRunRowResult } from './import.types.js';
import type { ImportDryRunReconcileUnit } from './import-job.worker-state.js';

const BATCH = 10;

function signatures(rows: DryRunRowResult[]) {
  return rows.map((row) => ({
    row_no: row.row_no,
    action: row.action,
    codes: row.errors.map((issue) => issue.code),
  }));
}

async function planBatched(
  plan: (
    input: ImportDryRunInput,
    parsed: ParsedCsv,
  ) => Promise<DryRunRowResult[]>,
  input: ImportDryRunInput,
  parsed: ParsedCsv,
  batchSize: number,
): Promise<DryRunRowResult[]> {
  const merged: DryRunRowResult[] = [];
  for (let offset = 0; offset < parsed.rows.length; offset += batchSize) {
    const slice: ParsedCsv = {
      headers: parsed.headers,
      rows: parsed.rows.slice(offset, offset + batchSize),
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
  const rowNos = [...unit.replan_row_nos].sort((left, right) => left - right);
  const records = rowNos.map((rowNo) => ({
    rowNo,
    record: Object.fromEntries(
      parsed.headers.map((header, index) => [
        header,
        parsed.rows[rowNo - 1][index],
      ]),
    ),
  }));
  const sparse: ParsedCsv = {
    headers: parsed.headers,
    rows: records.map((entry) =>
      parsed.headers.map((header) => entry.record[header] ?? ''),
    ),
    delimiter: parsed.delimiter,
    sha256: parsed.sha256,
  };
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
    target[row.row_no - 1] = row;
  }
}

describe('dry-run reconcile production paths', () => {
  it('vehicle party sync and background replan both flag a single-key cap+1 group', async () => {
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
    const dataRows = Array.from(
      { length: IMPORT_RECONCILE_GROUP_MAX_ROWS + 1 },
      (_, index) => [
        `p${index}`,
        'VEH-SAME',
        'CUST-1',
        'DRIVER',
        '2024-01-01',
        '',
        '',
      ],
    );
    const parsed = parseCsvFile(
      Buffer.from(serializeCsv(Object.values(mapping), dataRows), 'utf8'),
    );
    const prisma = {
      externalIdMapping: {
        findMany: jest.fn().mockResolvedValue([
          {
            entity_type: ImportEntityType.VEHICLE,
            external_id: 'VEH-SAME',
            entity_id: 'veh-1',
          },
          {
            entity_type: ImportEntityType.CUSTOMER,
            external_id: 'CUST-1',
            entity_id: 'cust-1',
          },
        ]),
      },
      vehicleParty: { findMany: jest.fn().mockResolvedValue([]) },
      vehicle: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'veh-1', customer_id: 'cust-1' }]),
      },
      importJobRow: {
        findMany: jest.fn().mockResolvedValue(
          dataRows.map((row, index) => ({
            row_no: index + 1,
            external_id: row[0],
            normalized_json: { vehicle_external_id: 'VEH-SAME' },
          })),
        ),
      },
    };
    const input = {
      tenantId: 't',
      sourceSystem: 'legacy',
      mapping,
      options: { cutover_date: '2026-11-01' },
    };
    const sync = await planVehiclePartyDryRun(prisma as never, input, parsed);
    expect(sync).toHaveLength(IMPORT_RECONCILE_GROUP_MAX_ROWS + 1);
    for (const row of sync) {
      expect(row.errors[0]?.code).toBe(IMPORT_ERROR_CODES.GROUP_TOO_LARGE);
    }

    const background = await replanImportDryRunUnit({
      prisma: prisma as never,
      fileStorage: {} as never,
      upload: { object_key: 'imports/test.csv' },
      fileSha256: 'sha',
      tenantId: 't',
      jobId: 'j',
      handler: {
        entityType: ImportEntityType.VEHICLE_PARTY,
        planDryRun: (dryRunInput: ImportDryRunInput, slice: ParsedCsv) =>
          planVehiclePartyDryRun(prisma as never, dryRunInput, slice),
      } as never,
      input,
      unit: {
        context_from_row: 1,
        context_to_row: IMPORT_RECONCILE_GROUP_MAX_ROWS + 1,
        replan_row_nos: Array.from(
          { length: IMPORT_RECONCILE_GROUP_MAX_ROWS + 1 },
          (_, index) => index + 1,
        ),
      },
    });
    expect(background).toHaveLength(IMPORT_RECONCILE_GROUP_MAX_ROWS + 1);
    for (const row of background) {
      expect(row.errors[0]?.code).toBe(IMPORT_ERROR_CODES.GROUP_TOO_LARGE);
    }
  });

  it('two far-apart external_id pairs only replan those rows and match sync', async () => {
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
    const last = 40;
    const csvRows = Array.from({ length: last }, (_, index) => {
      const rowNo = index + 1;
      let id = `solo-${rowNo}`;
      if (rowNo === 1 || rowNo === last) {
        id = 'pair-a';
      }
      if (rowNo === 2 || rowNo === last - 1) {
        id = 'pair-b';
      }
      return [id, 'PRIVATE', 'A', 'Name', '', '', '', 'AT'];
    });
    const parsed = parseCsvFile(
      Buffer.from(serializeCsv(Object.values(mapping), csvRows), 'utf8'),
    );
    const jobRows = csvRows.map((row, index) => ({
      row_no: index + 1,
      external_id: row[0],
      normalized_json: {},
    }));
    const prisma = {
      externalIdMapping: { findMany: jest.fn().mockResolvedValue([]) },
      customer: { findMany: jest.fn().mockResolvedValue([]) },
      importJobRow: { findMany: jest.fn().mockResolvedValue(jobRows) },
    };
    const units = await computeImportDryRunReconcileUnits(prisma as never, {
      tenantId: 't',
      jobId: 'j',
      entityType: ImportEntityType.CUSTOMER,
      batchSize: BATCH,
    });
    expect(units).toHaveLength(2);

    const input = {
      tenantId: 't',
      sourceSystem: 'legacy',
      mapping,
      options: {},
    };
    const plan = (dryRunInput: ImportDryRunInput, slice: ParsedCsv) =>
      planCustomerDryRun(prisma as never, dryRunInput, slice);
    const sync = await plan(input, parsed);
    const batched = await planBatched(plan, input, parsed, BATCH);
    for (const unit of units) {
      await replanUnit(plan, input, parsed, unit, batched);
    }
    expect(signatures(batched)).toEqual(signatures(sync));
  });
});
