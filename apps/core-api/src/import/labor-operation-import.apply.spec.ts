import { AuditLogAction, ImportRowAction } from '@prisma/client';
import { applyLaborOperationImportRow } from './labor-operation-import.apply.js';
import type { ImportAuditWriter } from './import-audit.writer.js';

function createApplyHarness(options: {
  existingFitment?: {
    id: string;
    year_from: number | null;
    year_to: number | null;
    engine_code: string | null;
  } | null;
  operationFitments?: Array<Record<string, unknown>>;
}) {
  const fitmentUpdate = jest.fn();
  const fitmentCreate = jest.fn().mockResolvedValue({ id: 'fit-new' });
  const tx = {
    laborOperation: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'op-1',
        tenant_id: 'tenant-1',
        code: 'AW-100',
        description: 'Oil change',
        standard_aw: 1.5,
        hourly_rate: 85,
        internal_cost: null,
        category_id: null,
        fitments: options.operationFitments ?? [],
      }),
      update: jest.fn().mockResolvedValue({ id: 'op-1' }),
      create: jest.fn(),
    },
    laborFitment: {
      findFirst: jest.fn().mockResolvedValue(options.existingFitment ?? null),
      update: fitmentUpdate,
      create: fitmentCreate,
    },
    externalIdMapping: {
      upsert: jest.fn().mockResolvedValue({}),
      create: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    importJobRow: { update: jest.fn().mockResolvedValue({}) },
  };
  const audit: Pick<ImportAuditWriter, 'writeEntityAudit'> = {
    writeEntityAudit: jest.fn().mockResolvedValue(undefined),
  };
  const ctx = {
    tenantId: 'tenant-1',
    job: {
      id: 'job-1',
      source_system: 'incadea',
      options_json: { update_existing: true },
    },
    actorUserId: 'user-1',
    audit: audit as ImportAuditWriter,
  };
  return { tx, ctx, audit, fitmentUpdate, fitmentCreate };
}

describe('labor-operation-import.apply', () => {
  it('does not clear stored fitment years when imported year is invalid (omitted)', async () => {
    const { tx, ctx, audit, fitmentUpdate } = createApplyHarness({
      existingFitment: {
        id: 'fit-1',
        year_from: 2015,
        year_to: 2020,
        engine_code: 'ABC',
      },
      operationFitments: [
        {
          make: 'VW',
          model: 'Golf',
          year_from: 2015,
          year_to: 2020,
          engine_code: 'ABC',
        },
      ],
    });

    await applyLaborOperationImportRow(tx as never, ctx, {
      row_no: 1,
      action: ImportRowAction.UPDATE,
      entity_id: 'op-1',
      external_id: '100',
      normalized_json: {
        external_id: '100',
        code: 'AW-100',
        description: 'Oil change',
        standard_aw: 1.5,
        hourly_rate: 85,
        internal_cost: null,
        category_id: null,
        fitment: { make: 'VW', model: 'Golf' },
      },
    });

    expect(fitmentUpdate).not.toHaveBeenCalled();
    expect(audit.writeEntityAudit).toHaveBeenCalledWith(
      tx,
      'tenant-1',
      'user-1',
      'job-1',
      'LaborOperation',
      'op-1',
      AuditLogAction.UPDATE,
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('stamps tenant_id when labor import creates a new fitment', async () => {
    const { tx, ctx, fitmentCreate } = createApplyHarness({});

    await applyLaborOperationImportRow(tx as never, ctx, {
      row_no: 1,
      action: ImportRowAction.UPDATE,
      entity_id: 'op-1',
      external_id: '100',
      normalized_json: {
        external_id: '100',
        code: 'AW-100',
        description: 'Oil change',
        standard_aw: 1.5,
        hourly_rate: 85,
        internal_cost: null,
        category_id: null,
        fitment: { make: 'VW', model: 'Golf', year_from: 2018 },
      },
    });

    expect(fitmentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenant_id: 'tenant-1',
        labor_operation_id: 'op-1',
        make: 'VW',
        model: 'Golf',
      }),
    });
  });
});
