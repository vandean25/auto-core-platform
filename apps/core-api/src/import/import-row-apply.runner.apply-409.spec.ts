import { ConflictException } from '@nestjs/common';
import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
} from '@prisma/client';
import { assignVehiclePartyApplySeqs } from './import-apply-sequence.test-util.js';
import type { ImportApplyRow } from './import-type-handler.js';
import type { ImportJobWorkerState } from './import-job.worker-state.js';
import { withApplyPersistedTotalsTransactionClient } from './import-apply-persisted-totals.test-util.js';
import { RowByRowApplyRunner } from './import-row-apply.runner.js';
import { VEHICLE_PARTY_RULE_CODES } from '../vehicle/vehicle-party.rules.js';

function buildRows(): ImportApplyRow[] {
  return [
    {
      row_no: 1,
      action: ImportRowAction.CREATE,
      entity_id: null,
      external_id: 'ok-1',
      normalized_json: { external_id: 'ok-1' },
    },
    {
      row_no: 2,
      action: ImportRowAction.CREATE,
      entity_id: null,
      external_id: 'conflict',
      normalized_json: {
        external_id: 'conflict',
        vehicle_id: 'veh-1',
        customer_id: 'cust-1',
        role: 'OWNER',
        valid_from: '2026-01-01',
        valid_to: null,
        notes: null,
      },
    },
    {
      row_no: 3,
      action: ImportRowAction.CREATE,
      entity_id: null,
      external_id: 'ok-3',
      normalized_json: { external_id: 'ok-3' },
    },
  ];
}

async function writeRowWithApplyOverlap(_tx: unknown, row: ImportApplyRow) {
  if (row.row_no === 2) {
    throw new ConflictException({
      code: VEHICLE_PARTY_RULE_CODES.OVERLAP,
      message: 'overlap at apply',
    });
  }
}

describe('RowByRowApplyRunner apply-time 409 on one of many rows', () => {
  const baseJob = {
    id: 'job-409',
    source_system: 'legacy',
    totals_json: { rows: 3, create: 0, update: 0, skip: 0, error: 0 },
  };

  it('records ERROR on the conflict row and APPLIES on sync legacy apply', async () => {
    const rowUpdates: unknown[] = [];
    const importJobRow = {
      findFirst: async () => null,
      update: jest.fn(async (args: { data: unknown }) => {
        rowUpdates.push(args.data);
      }),
    };
    const importJob = {
      update: jest.fn(async () => ({
        id: 'job-409',
        status: ImportJobStatus.APPLIED,
      })),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
    };
    const tx = withApplyPersistedTotalsTransactionClient(
      {
        externalIdMapping: { findFirst: async () => null },
        importJobRow,
        importJob,
      },
      { expectedRows: 3 },
    );
    const prisma = {
      externalIdMapping: { findFirst: async () => null },
      importJobRow,
      $transaction: async (fn: (client: typeof tx) => Promise<void>) => {
        await fn(tx);
      },
      importJob,
    };
    const runner = new RowByRowApplyRunner(
      prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) =>
        ({ ...job, totals, status: ImportJobStatus.APPLIED }) as never,
    );
    const result = await runner.run(
      {
        tenantId: 'tenant-1',
        job: { ...baseJob, options_json: {} },
        rows: buildRows(),
        actorUserId: 'user-1',
        effectiveOptions: {},
        preparation: { vendor: null },
      },
      ImportEntityType.VEHICLE_PARTY,
      writeRowWithApplyOverlap,
    );
    expect(result.status).toBe(ImportJobStatus.APPLIED);
    expect(result.totals).toEqual({
      rows: 3,
      create: 2,
      update: 0,
      skip: 0,
      error: 1,
    });
    expect(rowUpdates).toEqual([
      {
        action: ImportRowAction.ERROR,
        errors_json: [
          {
            code: VEHICLE_PARTY_RULE_CODES.OVERLAP,
            message: 'overlap at apply',
          },
        ],
      },
    ]);
  });

  it('records ERROR on the conflict row and APPLIES on sequence background apply', async () => {
    const worker: ImportJobWorkerState = {
      phase: 'apply',
      lease_token: 'lease-409',
      lease_until: new Date(0).toISOString(),
      processed_rows: 0,
      last_committed_apply_seq: 0,
      started_at: new Date().toISOString(),
    };
    const rows = assignVehiclePartyApplySeqs(buildRows());
    const maxApplySeq = 3;
    const rowUpdates: unknown[] = [];
    const tx = withApplyPersistedTotalsTransactionClient(
      {
        importJob: {
          findFirst: async () => ({
            id: 'job-409',
            tenant_id: 'tenant-1',
            status: ImportJobStatus.APPLYING,
            totals_json: baseJob.totals_json,
            options_json: { worker },
          }),
          update: async (args: {
            data: { options_json?: { worker: ImportJobWorkerState } };
          }) => {
            if (args.data.options_json?.worker) {
              Object.assign(worker, args.data.options_json.worker);
            }
          },
        },
        importJobRow: {
          findFirst: async () => null,
          update: jest.fn(async (args: { data: unknown }) => {
            rowUpdates.push(args.data);
          }),
        },
        externalIdMapping: { findFirst: async () => null },
      },
      { expectedRows: 3 },
    );
    const prisma = {
      externalIdMapping: { findFirst: async () => null },
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) =>
        fn(tx),
      importJob: {
        updateMany: jest.fn(),
        findFirst: async () => ({
          id: 'job-409',
          status: ImportJobStatus.APPLIED,
        }),
        update: jest.fn(),
      },
      importJobRow: {
        update: jest.fn(async (args: { data: unknown }) => {
          rowUpdates.push(args.data);
        }),
        findFirst: async () => null,
      },
    };
    const runner = new RowByRowApplyRunner(
      prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) =>
        ({ ...job, totals, status: ImportJobStatus.APPLIED }) as never,
    );
    const result = await runner.run(
      {
        tenantId: 'tenant-1',
        job: { ...baseJob, options_json: { worker } },
        rows,
        actorUserId: 'user-1',
        effectiveOptions: {},
        preparation: { vendor: null },
      },
      ImportEntityType.VEHICLE_PARTY,
      writeRowWithApplyOverlap,
      {
        stopAfterBatch: true,
        useApplySequence: true,
        maxApplySeq,
        leaseToken: worker.lease_token,
        hasMoreRowsAfterBatch: false,
      },
    );
    expect(result.status).toBe(ImportJobStatus.APPLIED);
    expect(result.totals.error).toBe(1);
    expect(result.totals.create).toBe(2);
    expect(rowUpdates).toContainEqual({
      action: ImportRowAction.ERROR,
      errors_json: [
        { code: VEHICLE_PARTY_RULE_CODES.OVERLAP, message: 'overlap at apply' },
      ],
    });
  });
});
