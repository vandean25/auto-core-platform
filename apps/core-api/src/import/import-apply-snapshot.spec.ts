import { ImportJobStatus, ImportRowAction, VehiclePartyRole } from '@prisma/client';
import { applyCustomerImportRow, CustomerApplyContext } from './customer-import.apply.js';
import { applyVehicleImportRow, VehicleApplyContext } from './vehicle-import-apply.row.js';
import { applyLaborOperationImportRow, LaborApplyContext } from './labor-operation-import.apply.js';
import { applyVehiclePartyImportRow, PartyApplyContext } from './vehicle-party-import.apply.js';
import { applyVehicleDueDateImportRow, DueDateApplyContext } from './vehicle-due-date-import.apply.js';
import { DUE_DATE_KIND } from './vehicle-due-date-import.logic.js';

describe('Import Apply Snapshot & Entity Tracking (AUT-813)', () => {
  const dummyAudit = {
    writeEntityAudit: jest.fn().mockResolvedValue(undefined),
    writeImportJobAudit: jest.fn().mockResolvedValue(undefined),
    writeImportJobUndoAudit: jest.fn().mockResolvedValue(undefined),
  } as any;

  const baseJob = {
    id: 'job-1',
    entity_type: 'CUSTOMER' as const,
    source_system: 'test_dms',
    status: ImportJobStatus.APPLYING,
    options_json: {},
    totals_json: { rows: 1, create: 0, update: 0, skip: 0, error: 0 },
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Customer apply', () => {
    it('sets entity_id on import_job_rows when creating a customer', async () => {
      const tx = {
        customer: {
          create: jest.fn().mockResolvedValue({ id: 'cust-123' }),
        },
        externalIdMapping: {
          create: jest.fn().mockResolvedValue({ id: 'map-1' }),
        },
        importJobRow: {
          update: jest.fn().mockResolvedValue({}),
        },
      } as any;

      const ctx: CustomerApplyContext = {
        tenantId: 'tenant-1',
        job: baseJob,
        actorUserId: 'user-1',
        audit: dummyAudit,
      };

      await applyCustomerImportRow(tx, ctx, {
        row_no: 1,
        action: ImportRowAction.CREATE,
        entity_id: null,
        external_id: 'EXT-1',
        normalized_json: {
          type: 'PRIVATE',
          first_name: 'Max',
          last_name: 'Muster',
          email: 'max@example.com',
        },
      });

      expect(tx.importJobRow.update).toHaveBeenCalledWith({
        where: {
          tenant_id_import_job_id_row_no: {
            tenant_id: 'tenant-1',
            import_job_id: 'job-1',
            row_no: 1,
          },
        },
        data: { entity_id: 'cust-123' },
      });
    });

    it('sets before_snapshot_json on import_job_rows when updating a customer', async () => {
      const existingCustomer = {
        id: 'cust-123',
        tenant_id: 'tenant-1',
        type: 'PRIVATE',
        company_name: null,
        first_name: 'OldFirst',
        last_name: 'OldLast',
        email: 'old@example.com',
        phone: '+43123456',
        vat_id: null,
        address_street: 'Str 1',
        address_zip: '1010',
        address_city: 'Wien',
        address_country: 'AT',
        contact_email_ok: true,
      };

      const tx = {
        customer: {
          findFirst: jest.fn().mockResolvedValue(existingCustomer),
          update: jest.fn().mockResolvedValue({ ...existingCustomer, first_name: 'NewFirst' }),
        },
        externalIdMapping: {
          upsert: jest.fn().mockResolvedValue({ id: 'map-1' }),
        },
        importJobRow: {
          update: jest.fn().mockResolvedValue({}),
        },
      } as any;

      const ctx: CustomerApplyContext = {
        tenantId: 'tenant-1',
        job: baseJob,
        actorUserId: 'user-1',
        audit: dummyAudit,
      };

      await applyCustomerImportRow(tx, ctx, {
        row_no: 2,
        action: ImportRowAction.UPDATE,
        entity_id: 'cust-123',
        external_id: 'EXT-1',
        normalized_json: {
          first_name: 'NewFirst',
        },
      });

      expect(tx.importJobRow.update).toHaveBeenCalledWith({
        where: {
          tenant_id_import_job_id_row_no: {
            tenant_id: 'tenant-1',
            import_job_id: 'job-1',
            row_no: 2,
          },
        },
        data: {
          before_snapshot_json: expect.objectContaining({
            first_name: 'OldFirst',
            last_name: 'OldLast',
            email: 'old@example.com',
            contact_email_ok: true,
          }),
        },
      });
    });
  });

  describe('Vehicle apply', () => {
    it('sets entity_id on CREATE and before_snapshot_json on UPDATE', async () => {
      const tx = {
        vehicle: {
          create: jest.fn().mockResolvedValue({ id: 'veh-123' }),
          findFirst: jest.fn().mockResolvedValue({
            id: 'veh-123',
            tenant_id: 'tenant-1',
            make: 'VW',
            model: 'Golf',
            year: 2020,
            vin: 'WVWZZZ123',
            plate: 'W-123AB',
            mileage: 50000,
            color: 'blue',
            key_number: null,
            customer_id: null,
            first_registration_date: new Date('2020-05-15T00:00:00.000Z'),
          }),
          update: jest.fn().mockResolvedValue({ id: 'veh-123' }),
        },
        externalIdMapping: {
          create: jest.fn().mockResolvedValue({ id: 'map-1' }),
          upsert: jest.fn().mockResolvedValue({ id: 'map-1' }),
        },
        importJobRow: {
          update: jest.fn().mockResolvedValue({}),
        },
      } as any;

      const ctx: VehicleApplyContext = {
        tenantId: 'tenant-1',
        job: { ...baseJob, entity_type: 'VEHICLE' },
        actorUserId: 'user-1',
        audit: dummyAudit,
      };

      await applyVehicleImportRow(tx, ctx, {
        row_no: 1,
        action: ImportRowAction.CREATE,
        entity_id: null,
        external_id: 'V-EXT-1',
        normalized_json: { make: 'VW', model: 'Golf', year: 2020 },
      });

      expect(tx.importJobRow.update).toHaveBeenCalledWith({
        where: {
          tenant_id_import_job_id_row_no: {
            tenant_id: 'tenant-1',
            import_job_id: 'job-1',
            row_no: 1,
          },
        },
        data: { entity_id: 'veh-123' },
      });

      await applyVehicleImportRow(tx, ctx, {
        row_no: 2,
        action: ImportRowAction.UPDATE,
        entity_id: 'veh-123',
        external_id: 'V-EXT-1',
        normalized_json: { mileage: 60000 },
      });

      expect(tx.importJobRow.update).toHaveBeenCalledWith({
        where: {
          tenant_id_import_job_id_row_no: {
            tenant_id: 'tenant-1',
            import_job_id: 'job-1',
            row_no: 2,
          },
        },
        data: {
          before_snapshot_json: expect.objectContaining({
            make: 'VW',
            model: 'Golf',
            mileage: 50000,
            first_registration_date: '2020-05-15',
          }),
        },
      });
    });
  });

  describe('Labor operation apply', () => {
    it('sets entity_id on CREATE and before_snapshot_json on UPDATE', async () => {
      const tx = {
        laborOperation: {
          create: jest.fn().mockResolvedValue({ id: 'labor-1' }),
          findFirst: jest.fn().mockResolvedValue({
            id: 'labor-1',
            tenant_id: 'tenant-1',
            code: 'INSP-1',
            description: 'Inspection',
            standard_aw: 10,
            hourly_rate: 120,
            internal_cost: 60,
            category_id: null,
            fitments: [],
          }),
          update: jest.fn().mockResolvedValue({ id: 'labor-1' }),
        },
        externalIdMapping: {
          create: jest.fn().mockResolvedValue({ id: 'map-1' }),
          upsert: jest.fn().mockResolvedValue({ id: 'map-1' }),
        },
        importJobRow: {
          update: jest.fn().mockResolvedValue({}),
        },
      } as any;

      const ctx: LaborApplyContext = {
        tenantId: 'tenant-1',
        job: { ...baseJob, entity_type: 'LABOR_OPERATION' },
        actorUserId: 'user-1',
        audit: dummyAudit,
      };

      await applyLaborOperationImportRow(tx, ctx, {
        row_no: 1,
        action: ImportRowAction.CREATE,
        entity_id: null,
        external_id: 'L-1',
        normalized_json: { code: 'INSP-1', description: 'Inspection' },
      });

      expect(tx.importJobRow.update).toHaveBeenCalledWith({
        where: {
          tenant_id_import_job_id_row_no: {
            tenant_id: 'tenant-1',
            import_job_id: 'job-1',
            row_no: 1,
          },
        },
        data: { entity_id: 'labor-1' },
      });

      await applyLaborOperationImportRow(tx, ctx, {
        row_no: 2,
        action: ImportRowAction.UPDATE,
        entity_id: 'labor-1',
        external_id: 'L-1',
        normalized_json: { description: 'Updated Inspection' },
      });

      expect(tx.importJobRow.update).toHaveBeenCalledWith({
        where: {
          tenant_id_import_job_id_row_no: {
            tenant_id: 'tenant-1',
            import_job_id: 'job-1',
            row_no: 2,
          },
        },
        data: {
          before_snapshot_json: expect.objectContaining({
            code: 'INSP-1',
            description: 'Inspection',
          }),
        },
      });
    });
  });

  describe('Vehicle party apply', () => {
    it('sets entity_id on CREATE and before_snapshot_json on UPDATE', async () => {
      const existingParty = {
        id: 'party-1',
        tenant_id: 'tenant-1',
        vehicle_id: 'v-1',
        customer_id: 'c-1',
        role: VehiclePartyRole.OWNER,
        valid_from: new Date('2020-01-01T00:00:00.000Z'),
        valid_to: null,
      };

      const tx = {
        customer: {
          findFirst: jest.fn().mockResolvedValue({ id: 'c-1', tenant_id: 'tenant-1' }),
        },
        vehicle: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        vehicleParty: {
          findMany: jest.fn().mockResolvedValueOnce([]).mockResolvedValue([existingParty]),
          findFirst: jest.fn().mockResolvedValue(existingParty),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          update: jest.fn().mockResolvedValue({
            id: 'party-1',
            vehicle_id: 'v-1',
            customer_id: 'c-1',
            role: VehiclePartyRole.OWNER,
            valid_from: new Date('2020-01-01T00:00:00.000Z'),
            valid_to: null,
          }),
          create: jest.fn().mockResolvedValue({
            id: 'party-created',
            vehicle_id: 'v-1',
            customer_id: 'c-1',
            role: VehiclePartyRole.OWNER,
            valid_from: new Date('2020-01-01T00:00:00.000Z'),
            valid_to: null,
          }),
        },
        externalIdMapping: {
          create: jest.fn().mockResolvedValue({ id: 'map-1' }),
        },
        importJobRow: {
          update: jest.fn().mockResolvedValue({}),
        },
      } as any;

      const ctx: PartyApplyContext = {
        tenantId: 'tenant-1',
        job: { ...baseJob, entity_type: 'VEHICLE_PARTY' },
        actorUserId: 'user-1',
        audit: dummyAudit,
      };

      await applyVehiclePartyImportRow(tx, ctx, {
        row_no: 1,
        action: ImportRowAction.CREATE,
        entity_id: null,
        external_id: 'P-1',
        normalized_json: {
          vehicle_id: 'v-1',
          customer_id: 'c-1',
          role: VehiclePartyRole.OWNER,
          valid_from: '2020-01-01',
          valid_to: null,
        },
      });

      expect(tx.importJobRow.update).toHaveBeenCalledWith({
        where: {
          tenant_id_import_job_id_row_no: {
            tenant_id: 'tenant-1',
            import_job_id: 'job-1',
            row_no: 1,
          },
        },
        data: { entity_id: 'party-created' },
      });

      await applyVehiclePartyImportRow(tx, ctx, {
        row_no: 2,
        action: ImportRowAction.UPDATE,
        entity_id: 'party-1',
        external_id: 'P-1',
        normalized_json: {
          vehicle_id: 'v-1',
          customer_id: 'c-1',
          role: VehiclePartyRole.OWNER,
          valid_from: '2020-01-01',
          valid_to: '2022-01-01',
        },
      });

      expect(tx.importJobRow.update).toHaveBeenCalledWith({
        where: {
          tenant_id_import_job_id_row_no: {
            tenant_id: 'tenant-1',
            import_job_id: 'job-1',
            row_no: 2,
          },
        },
        data: {
          before_snapshot_json: expect.objectContaining({
            vehicle_id: 'v-1',
            customer_id: 'c-1',
            role: VehiclePartyRole.OWNER,
          }),
        },
      });
    });
  });

  describe('Vehicle due date apply', () => {
    it('sets entity_id on CREATE and before_snapshot_json on UPDATE', async () => {
      const tx = {
        vehicle: {
          findFirst: jest.fn().mockResolvedValue({ id: 'v-1' }),
        },
        vehicleNotice: {
          create: jest.fn().mockResolvedValue({
            id: 'notice-1',
            vehicle_id: 'v-1',
            type: 'SERVICE_DUE',
            status: 'OPEN',
            due_date: new Date('2025-01-01T00:00:00.000Z'),
            due_mileage: null,
            external_ref: 'DUE-1',
          }),
          findFirst: jest.fn().mockResolvedValue({
            id: 'notice-1',
            tenant_id: 'tenant-1',
            due_date: new Date('2024-01-01T00:00:00.000Z'),
            due_mileage: 100000,
            body: 'Old note',
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        vehicleInspectionRecord: {
          create: jest.fn().mockResolvedValue({ id: 'insp-1' }),
        },
        externalIdMapping: {
          create: jest.fn().mockResolvedValue({ id: 'map-1' }),
        },
        importJobRow: {
          update: jest.fn().mockResolvedValue({}),
        },
      } as any;

      const ctx: DueDateApplyContext = {
        tenantId: 'tenant-1',
        job: { ...baseJob, entity_type: 'VEHICLE_DUE_DATE' },
        actorUserId: 'user-1',
        audit: dummyAudit,
      };

      await applyVehicleDueDateImportRow(tx, ctx, {
        row_no: 1,
        action: ImportRowAction.CREATE,
        entity_id: null,
        external_id: 'DUE-1',
        normalized_json: {
          kind: DUE_DATE_KIND.SERVICE,
          vehicle_id: 'v-1',
          due_date: '2025-01-01',
          external_ref: 'DUE-1',
        },
      });

      expect(tx.importJobRow.update).toHaveBeenCalledWith({
        where: {
          tenant_id_import_job_id_row_no: {
            tenant_id: 'tenant-1',
            import_job_id: 'job-1',
            row_no: 1,
          },
        },
        data: { entity_id: 'notice-1' },
      });

      await applyVehicleDueDateImportRow(tx, ctx, {
        row_no: 2,
        action: ImportRowAction.UPDATE,
        entity_id: 'notice-1',
        external_id: 'DUE-1',
        normalized_json: {
          kind: DUE_DATE_KIND.SERVICE,
          vehicle_id: 'v-1',
          notes: 'New note',
          external_ref: 'DUE-1',
        },
      });

      expect(tx.importJobRow.update).toHaveBeenCalledWith({
        where: {
          tenant_id_import_job_id_row_no: {
            tenant_id: 'tenant-1',
            import_job_id: 'job-1',
            row_no: 2,
          },
        },
        data: {
          before_snapshot_json: expect.objectContaining({
            due_mileage: 100000,
            body: 'Old note',
          }),
        },
      });
    });
  });
});
