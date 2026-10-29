import type { Prisma, VehicleNotice } from '@prisma/client';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import { ImportAuditWriter } from './import-audit.writer.js';
import { applyVehicleDueDateImportRow } from './vehicle-due-date-import.apply.js';

it.each([
  {
    name: 'replacing notes',
    previousNotes: 'Stored synthetic note',
    fillEmptyOnly: false,
  },
  { name: 'filling empty notes', previousNotes: null, fillEmptyOnly: true },
])(
  'preserves service note audit history when $name',
  async ({ previousNotes, fillEmptyOnly }) => {
    const notice: VehicleNotice = {
      id: 'notice-1',
      tenant_id: 'tenant-a',
      vehicle_id: 'vehicle-1',
      type: 'SERVICE_DUE',
      title: 'Service',
      status: 'OPEN',
      source: 'LEGACY_IMPORT',
      body: previousNotes,
      due_date: new Date('2099-01-15T00:00:00Z'),
      due_mileage: 60000,
      external_ref: 'SYN-SCHEDULE',
      created_by_user_id: null,
      resolved_at: null,
      resolved_by_user_id: null,
      resolved_workshop_order_id: null,
      createdAt: new Date('2020-01-01T00:00:00Z'),
      updatedAt: new Date('2020-01-01T00:00:00Z'),
    };
    const writtenAudits: Prisma.AuditLogUncheckedCreateInput[] = [];
    const transaction = {
      vehicleNotice: {
        findFirst: async () => notice,
        updateMany: async () => ({ count: 1 }),
      },
      auditLog: {
        create: async ({
          data,
        }: {
          data: Prisma.AuditLogUncheckedCreateInput;
        }) => {
          writtenAudits.push(data);
          return data;
        },
      },
    } as unknown as Prisma.TransactionClient;
    const tenantContext = {
      getAuthenticatedUser: () => ({
        email: 'synthetic@example.com',
        role: 'ADMIN',
      }),
    } as unknown as TenantContextService;

    await applyVehicleDueDateImportRow(
      transaction,
      {
        tenantId: 'tenant-a',
        actorUserId: 'user-1',
        job: {
          id: 'job-1',
          source_system: 'synthetic-import',
          options_json: {
            update_existing: true,
            fill_empty_only: fillEmptyOnly,
          },
        },
        audit: new ImportAuditWriter(tenantContext),
      },
      {
        row_no: 1,
        action: 'UPDATE',
        entity_id: notice.id,
        external_id: 'DUE-SERVICE',
        normalized_json: {
          kind: 'SERVICE',
          vehicle_id: notice.vehicle_id,
          due_date: '2099-01-15',
          due_mileage: 60000,
          external_ref: 'SYN-SCHEDULE',
          notes: 'Updated synthetic note',
        },
      },
    );

    expect(writtenAudits).toHaveLength(1);
    expect(writtenAudits[0]).toMatchObject({
      entity_type: 'VehicleNotice',
      entity_id: notice.id,
      action: 'UPDATE',
      before: {
        due_date: '2099-01-15',
        due_mileage: 60000,
        body: previousNotes,
      },
      after: { importJobId: 'job-1', body: 'Updated synthetic note' },
      diff: {
        body: { before: previousNotes, after: 'Updated synthetic note' },
      },
    });
  },
);
