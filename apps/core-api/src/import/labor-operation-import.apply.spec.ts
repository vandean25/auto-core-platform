import { AuditLogAction, ImportRowAction } from '@prisma/client';
import { applyLaborOperationImportRow } from './labor-operation-import.apply.js';
import type { ImportAuditWriter } from './import-audit.writer.js';

describe('labor-operation-import.apply', () => {
  it('does not clear stored fitment years when imported year is invalid (omitted)', async () => {
    const fitmentUpdate = jest.fn();
    const laborFitment = {
      findFirst: jest.fn().mockResolvedValue({
        id: 'fit-1',
        year_from: 2015,
        year_to: 2020,
        engine_code: 'ABC',
      }),
      update: fitmentUpdate,
      create: jest.fn(),
    };
    const laborOperation = {
      findFirst: jest.fn().mockResolvedValue({
        id: 'op-1',
        tenant_id: 'tenant-1',
        code: 'AW-100',
        description: 'Oil change',
        standard_aw: 1.5,
        hourly_rate: 85,
        internal_cost: null,
        category_id: null,
        fitments: [
          {
            make: 'VW',
            model: 'Golf',
            year_from: 2015,
            year_to: 2020,
            engine_code: 'ABC',
          },
        ],
      }),
      update: jest.fn().mockResolvedValue({ id: 'op-1' }),
      create: jest.fn(),
    };
    const tx = {
      laborOperation,
      laborFitment,
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

    await applyLaborOperationImportRow(
      tx as never,
      {
        tenantId: 'tenant-1',
        job: {
          id: 'job-1',
          source_system: 'incadea',
          options_json: { update_existing: true },
        },
        actorUserId: 'user-1',
        audit: audit as ImportAuditWriter,
      },
      {
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
      },
    );

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
});
