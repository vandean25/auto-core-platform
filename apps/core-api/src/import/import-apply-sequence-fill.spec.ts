import { Prisma } from '@prisma/client';
import { fillImportJobApplySequences } from './import-apply-sequence-fill.js';
import { ImportRowAction, VehiclePartyRole } from '@prisma/client';
import type { ImportApplyRow } from './import-type-handler.js';
import { orderVehiclePartyApplyRows } from './vehicle-party-import.apply-order.js';

function plannedRow(rowNo: number, action: ImportRowAction): ImportApplyRow {
  return {
    row_no: rowNo,
    action,
    entity_id: action === ImportRowAction.UPDATE ? `party-${rowNo}` : null,
    external_id: `ext-${rowNo}`,
    normalized_json: {
      external_id: `ext-${rowNo}`,
      vehicle_id: 'veh-1',
      customer_id: 'cust-1',
      role: VehiclePartyRole.OWNER,
      valid_from: '2026-01-01',
      valid_to: action === ImportRowAction.UPDATE ? '2026-06-01' : null,
      notes: null,
    },
  };
}

describe('fillImportJobApplySequences SQL order', () => {
  it('uses updates_first ordering that matches orderVehiclePartyApplyRows', () => {
    const fileRows = Array.from({ length: 12 }, (_, index) => {
      const rowNo = index + 1;
      const action =
        rowNo === 5
          ? ImportRowAction.SKIP
          : rowNo <= 8
            ? ImportRowAction.UPDATE
            : ImportRowAction.CREATE;
      return plannedRow(rowNo, action);
    });
    const memoryOrder = orderVehiclePartyApplyRows(fileRows).map((r) => r.row_no);
    const updatesFirst = fileRows
      .slice()
      .sort((a, b) => {
        const aUpdate = a.action === ImportRowAction.UPDATE ? 0 : 1;
        const bUpdate = b.action === ImportRowAction.UPDATE ? 0 : 1;
        if (aUpdate !== bUpdate) {
          return aUpdate - bUpdate;
        }
        return a.row_no - b.row_no;
      })
      .map((r) => r.row_no);
    expect(updatesFirst).toEqual(memoryOrder);
    expect(memoryOrder.indexOf(5)).toBeGreaterThan(memoryOrder.indexOf(8));
  });

  it('runs row_no and updates_first as separate fixed executeRaw statements', async () => {
    const executeRaw = jest.fn(async () => 1);
    const tx = {
      $executeRaw: executeRaw,
    } as unknown as Prisma.TransactionClient;
    await fillImportJobApplySequences(tx, 'tenant-1', 'job-1', 'row_no');
    await fillImportJobApplySequences(tx, 'tenant-1', 'job-1', 'updates_first');
    expect(executeRaw).toHaveBeenCalledTimes(2);
    const calls = executeRaw.mock.calls as unknown as [
      TemplateStringsArray,
      ...unknown[],
    ][];
    const rowNoSql = calls[0]?.[0].join('') ?? '';
    const updatesFirstSql = calls[1]?.[0].join('') ?? '';
    expect(rowNoSql).toContain('ORDER BY row_no');
    expect(updatesFirstSql).toContain("action <> 'UPDATE'");
    expect(updatesFirstSql).toContain('row_no');
  });
});
