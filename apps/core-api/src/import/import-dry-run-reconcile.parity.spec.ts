import { ImportEntityType, ImportRowAction } from '@prisma/client';
import { parseCsvFile, serializeCsv } from './csv-parse.util.js';
import { planCustomerDryRun } from './customer-import.dry-run.js';
import { planVehiclePartyDryRun } from './vehicle-party-import.dry-run.js';
import type { DryRunRowResult } from './import.types.js';
import type { ParsedCsv } from './csv-parse.util.js';
import type { ImportDryRunInput } from './import-type-handler.js';

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

async function replanRange(
  plan: (
    input: ImportDryRunInput,
    parsed: ParsedCsv,
  ) => Promise<DryRunRowResult[]>,
  input: ImportDryRunInput,
  parsed: ParsedCsv,
  fromRow: number,
  toRow: number,
  target: DryRunRowResult[],
) {
  const offset = fromRow - 1;
  const slice: ParsedCsv = {
    headers: parsed.headers,
    rows: parsed.rows.slice(offset, toRow),
  };
  const replanned = await plan(
    { ...input, planBudget: { deadlineMs: Date.now() + 60_000, rowNoOffset: fromRow } },
    slice,
  );
  for (const row of replanned) {
    const index = target.findIndex((item) => item.row_no === row.row_no);
    if (index >= 0) {
      target[index] = row;
    }
  }
}

describe('dry-run reconcile parity (sync vs batched + range replan)', () => {
  const prisma = {
    externalIdMapping: { findMany: jest.fn().mockResolvedValue([]) },
    customer: { findMany: jest.fn().mockResolvedValue([]) },
    vehicle: { findMany: jest.fn().mockResolvedValue([]) },
    vehicleParty: { findMany: jest.fn().mockResolvedValue([]) },
  } as never;

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
      planCustomerDryRun(prisma, dryRunInput, slice);
    const sync = await plan(input, parsed);
    const batched = await planBatched(plan, input, parsed);
    expect(batched[3].action).toBe(ImportRowAction.CREATE);
    await replanRange(plan, input, parsed, 1, 4, batched);
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
      planVehiclePartyDryRun(prisma, dryRunInput, slice);
    const sync = await plan(input, parsed);
    const batched = await planBatched(plan, input, parsed);
    await replanRange(plan, input, parsed, 1, 4, batched);
    expect(signatures(batched)).toEqual(signatures(sync));
  });
});
